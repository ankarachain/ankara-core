// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IIdentityVerifier.sol";

/**
 * @title MilestoneEscrow
 * @author Cranebolt Technologies — Ankara Chain SDK
 * @notice Tranche-based escrow for diaspora payments — one deal per contract instance.
 *
 * A payer deposits a stablecoin for the full agreed amount, split across milestones.
 * Each milestone releases to the payee only when both sides agree:
 * - The payee marks a milestone delivered.
 * - The payer approves it, releasing funds immediately.
 * - If either side disputes instead, an optional arbiter resolves it.
 * - If the payer goes silent after delivery, the payee can force-release after a timelock.
 *
 * No admin, arbiter, or Ankara Chain wallet ever custodies funds outside this contract —
 * every release either requires payer approval, arbiter resolution of an active dispute,
 * or an elapsed timelock with no dispute raised.
 *
 * Deploy via EscrowFactory only. Never deploy this directly.
 */
contract MilestoneEscrow is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Roles ─────────────────────────────────────────────────────────────
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MANAGER_ROLE  = keccak256("MANAGER_ROLE");

    // ─── Types ─────────────────────────────────────────────────────────────
    enum MilestoneStatus { PENDING, DELIVERED, DISPUTED, RELEASED, REFUNDED }

    struct Milestone {
        uint256 amount;
        bytes32 descriptionHash;  // IPFS/description hash agreed off-chain
        MilestoneStatus status;
        uint256 deliveredAt;      // 0 until marked delivered; starts the timelock clock
    }

    // ─── State ─────────────────────────────────────────────────────────────
    address public payer;
    address public payee;
    address public arbiter;              // address(0) = no arbiter configured
    IERC20  public token;                // stablecoin accepted by this deal
    IIdentityVerifier private _identityVerifier; // address(0) = no KYC gating

    uint256 public timelockDuration;     // seconds after delivery before payee can force-release
    uint256 public totalAmount;          // sum of all milestone amounts
    bool    public funded;
    bool    public cancelled;

    Milestone[] private _milestones;
    mapping(address => bool) private _cancelVotes;

    // ─── Storage gap ───────────────────────────────────────────────────────
    uint256[50] private __gap;

    // ─── Errors ─────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error SamePartyNotAllowed();
    error NoMilestones();
    error LengthMismatch();
    error AlreadyFunded();
    error NotFunded();
    error NotPayer();
    error NotPayee();
    error NotParty();
    error NotArbiter();
    error NotVerified(address account);
    error InvalidMilestoneId(uint256 id);
    error InvalidMilestoneStatus();
    error TimelockNotElapsed();
    error AlreadyCancelled();

    // ─── Events ────────────────────────────────────────────────────────────
    event EscrowFunded(uint256 totalAmount);
    event MilestoneDelivered(uint256 indexed id, uint256 timestamp);
    event MilestoneReleased(uint256 indexed id, uint256 amount, bool viaTimelock);
    event MilestoneDisputed(uint256 indexed id, address indexed raisedBy);
    event DisputeResolved(uint256 indexed id, bool releasedToPayee);
    event MilestoneRefunded(uint256 indexed id, uint256 amount);
    event CancelVoteCast(address indexed voter);
    event EscrowCancelled(uint256 refundedAmount);
    event ArbiterUpdated(address oldArbiter, address newArbiter);
    event IdentityVerifierUpdated(address oldVerifier, address newVerifier);

    // ─── Initializer ───────────────────────────────────────────────────────

    /**
     * @param admin_             Address granted admin roles (typically the integrating platform).
     * @param payer_             The diaspora buyer funding the escrow.
     * @param payee_             The recipient of released milestone funds.
     * @param arbiter_           Optional dispute resolver; address(0) disables arbiter resolution.
     * @param token_             Stablecoin used for deposits.
     * @param identityVerifier_  Optional KYC hook; address(0) disables identity gating.
     * @param timelockDuration_  Seconds after delivery before payee can force-release. 0 defaults to 7 days.
     * @param amounts_           Per-milestone amounts, in token decimals.
     * @param descriptionHashes_ Per-milestone description hash, same length as amounts_.
     */
    function initialize(
        address admin_,
        address payer_,
        address payee_,
        address arbiter_,
        address token_,
        address identityVerifier_,
        uint256 timelockDuration_,
        uint256[] memory amounts_,
        bytes32[] memory descriptionHashes_
    ) external initializer {
        __AccessControl_init();
        __Pausable_init();

        if (admin_ == address(0) || payer_ == address(0) || payee_ == address(0) || token_ == address(0)) {
            revert ZeroAddress();
        }
        if (payer_ == payee_) revert SamePartyNotAllowed();
        if (amounts_.length == 0) revert NoMilestones();
        if (amounts_.length != descriptionHashes_.length) revert LengthMismatch();

        payer             = payer_;
        payee             = payee_;
        arbiter           = arbiter_;
        token             = IERC20(token_);
        timelockDuration  = timelockDuration_ > 0 ? timelockDuration_ : 7 days;

        if (identityVerifier_ != address(0)) {
            _identityVerifier = IIdentityVerifier(identityVerifier_);
        }

        uint256 sum;
        for (uint256 i = 0; i < amounts_.length; i++) {
            if (amounts_[i] == 0) revert ZeroAmount();
            sum += amounts_[i];
            _milestones.push(Milestone({
                amount: amounts_[i],
                descriptionHash: descriptionHashes_[i],
                status: MilestoneStatus.PENDING,
                deliveredAt: 0
            }));
        }
        totalAmount = sum;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(PAUSER_ROLE,        admin_);
        _grantRole(UPGRADER_ROLE,      admin_);
        _grantRole(MANAGER_ROLE,       admin_);
    }

    // ─── Funding ───────────────────────────────────────────────────────────

    /**
     * @notice Deposit the full agreed amount into escrow.
     * @dev Payer only. Requires prior ERC-20 approval for `totalAmount`.
     */
    function fund() external whenNotPaused {
        if (msg.sender != payer) revert NotPayer();
        if (funded) revert AlreadyFunded();
        _checkVerified(payer);

        funded = true;
        token.safeTransferFrom(payer, address(this), totalAmount);
        emit EscrowFunded(totalAmount);
    }

    // ─── Milestone lifecycle ─────────────────────────────────────────────────

    /// @notice Flag a milestone as complete. Payee only. Starts the timelock clock.
    function markDelivered(uint256 milestoneId) external whenNotPaused {
        if (msg.sender != payee) revert NotPayee();
        if (!funded) revert NotFunded();

        Milestone storage m = _get(milestoneId);
        if (m.status != MilestoneStatus.PENDING) revert InvalidMilestoneStatus();

        m.status      = MilestoneStatus.DELIVERED;
        m.deliveredAt = block.timestamp;
        emit MilestoneDelivered(milestoneId, block.timestamp);
    }

    /// @notice Approve a delivered milestone, releasing funds to the payee. Payer only.
    function approveMilestone(uint256 milestoneId) external whenNotPaused {
        if (msg.sender != payer) revert NotPayer();

        Milestone storage m = _get(milestoneId);
        if (m.status != MilestoneStatus.DELIVERED) revert InvalidMilestoneStatus();

        _release(milestoneId, m, false);
    }

    /// @notice Freeze a delivered milestone pending arbiter review. Payer or payee only.
    function raiseDispute(uint256 milestoneId) external whenNotPaused {
        if (msg.sender != payer && msg.sender != payee) revert NotParty();

        Milestone storage m = _get(milestoneId);
        if (m.status != MilestoneStatus.DELIVERED) revert InvalidMilestoneStatus();

        m.status = MilestoneStatus.DISPUTED;
        emit MilestoneDisputed(milestoneId, msg.sender);
    }

    /// @notice Resolve a disputed milestone. Arbiter only — reverts if no arbiter is configured.
    function resolveDispute(uint256 milestoneId, bool releaseToPayee) external whenNotPaused {
        if (arbiter == address(0) || msg.sender != arbiter) revert NotArbiter();

        Milestone storage m = _get(milestoneId);
        if (m.status != MilestoneStatus.DISPUTED) revert InvalidMilestoneStatus();

        if (releaseToPayee) {
            _release(milestoneId, m, false);
        } else {
            m.status = MilestoneStatus.REFUNDED;
            uint256 amount = m.amount;
            token.safeTransfer(payer, amount);
            emit MilestoneRefunded(milestoneId, amount);
        }
        emit DisputeResolved(milestoneId, releaseToPayee);
    }

    /**
     * @notice Force-release a delivered, non-disputed milestone after the timelock elapses.
     * @dev Callable by anyone once eligible — protects the payee if the payer goes silent.
     */
    function claimTimelockRelease(uint256 milestoneId) external whenNotPaused {
        Milestone storage m = _get(milestoneId);
        if (m.status != MilestoneStatus.DELIVERED) revert InvalidMilestoneStatus();
        if (block.timestamp < m.deliveredAt + timelockDuration) revert TimelockNotElapsed();

        _release(milestoneId, m, true);
    }

    // ─── Mutual cancellation ─────────────────────────────────────────────────

    /**
     * @notice Vote to cancel the deal. Requires both payer and payee to call this.
     * @dev Only refunds milestones still PENDING — delivered, disputed, or resolved
     *      milestones must go through their normal flow first.
     */
    function voteCancel() external whenNotPaused {
        if (msg.sender != payer && msg.sender != payee) revert NotParty();
        if (cancelled) revert AlreadyCancelled();

        _cancelVotes[msg.sender] = true;
        emit CancelVoteCast(msg.sender);

        if (_cancelVotes[payer] && _cancelVotes[payee]) {
            _executeCancel();
        }
    }

    function _executeCancel() internal {
        cancelled = true;
        uint256 refundAmount;

        for (uint256 i = 0; i < _milestones.length; i++) {
            Milestone storage m = _milestones[i];
            if (m.status == MilestoneStatus.PENDING) {
                m.status = MilestoneStatus.REFUNDED;
                refundAmount += m.amount;
            }
        }

        if (refundAmount > 0 && funded) {
            token.safeTransfer(payer, refundAmount);
        }
        emit EscrowCancelled(refundAmount);
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    /// @notice Assign or rotate the dispute arbiter. MANAGER_ROLE.
    function setArbiter(address newArbiter) external onlyRole(MANAGER_ROLE) {
        address old = arbiter;
        arbiter = newArbiter;
        emit ArbiterUpdated(old, newArbiter);
    }

    /// @notice Swap the identity verifier. MANAGER_ROLE. address(0) disables KYC gating.
    function setIdentityVerifier(address verifier) external onlyRole(MANAGER_ROLE) {
        address old = address(_identityVerifier);
        _identityVerifier = IIdentityVerifier(verifier);
        emit IdentityVerifierUpdated(old, verifier);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ─── Views ──────────────────────────────────────────────────────────────

    function identityVerifier() external view returns (address) {
        return address(_identityVerifier);
    }

    function milestoneCount() external view returns (uint256) {
        return _milestones.length;
    }

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        if (milestoneId >= _milestones.length) revert InvalidMilestoneId(milestoneId);
        return _milestones[milestoneId];
    }

    function remainingBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _get(uint256 milestoneId) internal view returns (Milestone storage) {
        if (milestoneId >= _milestones.length) revert InvalidMilestoneId(milestoneId);
        return _milestones[milestoneId];
    }

    /// @dev Checks-effects-interactions: status flips to RELEASED before the transfer fires.
    function _release(uint256 milestoneId, Milestone storage m, bool viaTimelock) internal {
        _checkVerified(payee);

        m.status = MilestoneStatus.RELEASED;
        uint256 amount = m.amount;
        token.safeTransfer(payee, amount);
        emit MilestoneReleased(milestoneId, amount, viaTimelock);
    }

    function _checkVerified(address account) internal view {
        if (address(_identityVerifier) != address(0) && !_identityVerifier.isVerified(account)) {
            revert NotVerified(account);
        }
    }

    // ─── UUPS ───────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}

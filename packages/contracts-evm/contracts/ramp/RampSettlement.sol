// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RampSettlement
 * @author Cranebolt Technologies — Ankara Chain SDK
 * @notice Optional on-chain settlement layer for fiat on-ramp / off-ramp flows.
 *
 * This contract does not talk to any payment provider — it's the on-chain half
 * of a flow orchestrated off-chain (see the SDK's RampManager class). The
 * off-chain provider handles KYC and the actual fiat movement; this contract
 * provides a verifiable on-chain record of the crypto side of a settlement.
 *
 * Off-ramp (real custody): a user converting tokens to fiat deposits them here
 * via initiateOffRamp(). Once the platform's backend confirms the provider paid
 * out fiat to the user, SETTLER_ROLE calls confirmOffRampSettlement() to release
 * the custodied tokens to the treasury. If the payout fails, MANAGER_ROLE can
 * refund the depositor instead.
 *
 * On-ramp (attestation only): a user paying fiat to receive tokens does not
 * deposit anything here — the actual mint is performed by the platform's
 * existing token contracts (MINTER_ROLE), which this contract intentionally
 * does not hold for arbitrary tokens. recordOnRampSettlement() just writes a
 * verifiable, idempotent on-chain record tying a provider settlement reference
 * to the recipient/token/amount that was minted, for audit purposes.
 *
 * Deploy via RampSettlementFactory only. Never deploy this directly.
 */
contract RampSettlement is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Roles ─────────────────────────────────────────────────────────────
    bytes32 public constant SETTLER_ROLE  = keccak256("SETTLER_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MANAGER_ROLE  = keccak256("MANAGER_ROLE");

    // ─── Types ─────────────────────────────────────────────────────────────
    enum SettlementStatus { NONE, PENDING, SETTLED, REFUNDED, RECORDED }

    struct OffRampDeposit {
        address depositor;
        address token;
        uint256 amount;
        SettlementStatus status;
        uint256 initiatedAt;
    }

    struct OnRampRecord {
        address recipient;
        address token;
        uint256 amount;
        SettlementStatus status;
        uint256 recordedAt;
    }

    // ─── State ─────────────────────────────────────────────────────────────
    address public treasury;

    mapping(bytes32 => OffRampDeposit) private _offRamps;
    mapping(bytes32 => OnRampRecord)   private _onRamps;

    // ─── Storage gap ───────────────────────────────────────────────────────
    uint256[50] private __gap;

    // ─── Errors ─────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error ReferenceAlreadyUsed(bytes32 referenceId);
    error InvalidStatus();

    // ─── Events ────────────────────────────────────────────────────────────
    event OffRampInitiated(
        bytes32 indexed referenceId,
        address indexed depositor,
        address token,
        uint256 amount,
        string  providerRef
    );
    event OffRampSettled(bytes32 indexed referenceId, address treasury, uint256 amount);
    event OffRampRefunded(bytes32 indexed referenceId, address depositor, uint256 amount);
    event OnRampRecorded(
        bytes32 indexed referenceId,
        address indexed recipient,
        address token,
        uint256 amount,
        string  providerRef
    );
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    // ─── Initializer ───────────────────────────────────────────────────────

    /**
     * @param admin_    Address granted admin roles (typically the integrating platform).
     * @param treasury_ Address that receives settled off-ramp deposits.
     */
    function initialize(address admin_, address treasury_) external initializer {
        __AccessControl_init();
        __Pausable_init();

        if (admin_ == address(0) || treasury_ == address(0)) revert ZeroAddress();

        treasury = treasury_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(SETTLER_ROLE,       admin_);
        _grantRole(PAUSER_ROLE,        admin_);
        _grantRole(UPGRADER_ROLE,      admin_);
        _grantRole(MANAGER_ROLE,       admin_);
    }

    // ─── Off-ramp ────────────────────────────────────────────────────────────

    /**
     * @notice Deposit tokens for off-ramp to fiat. Caller must approve this contract first.
     * @dev referenceId ties this deposit to the off-chain provider payout session.
     */
    function initiateOffRamp(
        bytes32 referenceId,
        address token,
        uint256 amount,
        string calldata providerRef
    ) external whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (_offRamps[referenceId].status != SettlementStatus.NONE) revert ReferenceAlreadyUsed(referenceId);

        _offRamps[referenceId] = OffRampDeposit({
            depositor:   msg.sender,
            token:       token,
            amount:      amount,
            status:      SettlementStatus.PENDING,
            initiatedAt: block.timestamp
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit OffRampInitiated(referenceId, msg.sender, token, amount, providerRef);
    }

    /**
     * @notice Confirm the provider paid out fiat, releasing custodied tokens to the treasury.
     * @dev SETTLER_ROLE — called by the platform backend after verifying the provider's webhook.
     */
    function confirmOffRampSettlement(bytes32 referenceId) external onlyRole(SETTLER_ROLE) whenNotPaused {
        OffRampDeposit storage d = _offRamps[referenceId];
        if (d.status != SettlementStatus.PENDING) revert InvalidStatus();

        d.status = SettlementStatus.SETTLED;
        IERC20(d.token).safeTransfer(treasury, d.amount);
        emit OffRampSettled(referenceId, treasury, d.amount);
    }

    /**
     * @notice Return custodied tokens to the original depositor if the fiat payout failed.
     * @dev MANAGER_ROLE.
     */
    function refundOffRamp(bytes32 referenceId) external onlyRole(MANAGER_ROLE) whenNotPaused {
        OffRampDeposit storage d = _offRamps[referenceId];
        if (d.status != SettlementStatus.PENDING) revert InvalidStatus();

        d.status = SettlementStatus.REFUNDED;
        IERC20(d.token).safeTransfer(d.depositor, d.amount);
        emit OffRampRefunded(referenceId, d.depositor, d.amount);
    }

    // ─── On-ramp ─────────────────────────────────────────────────────────────

    /**
     * @notice Record an on-chain attestation that a fiat-funded mint/transfer happened.
     * @dev SETTLER_ROLE. Does not move funds — the actual mint is performed separately
     *      by the platform via the target token's own MINTER_ROLE. This is a paper trail.
     */
    function recordOnRampSettlement(
        bytes32 referenceId,
        address recipient,
        address token,
        uint256 amount,
        string calldata providerRef
    ) external onlyRole(SETTLER_ROLE) whenNotPaused {
        if (recipient == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (_onRamps[referenceId].status != SettlementStatus.NONE) revert ReferenceAlreadyUsed(referenceId);

        _onRamps[referenceId] = OnRampRecord({
            recipient:  recipient,
            token:      token,
            amount:     amount,
            status:     SettlementStatus.RECORDED,
            recordedAt: block.timestamp
        });

        emit OnRampRecorded(referenceId, recipient, token, amount, providerRef);
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    /// @notice Update the treasury address that receives settled off-ramp deposits. MANAGER_ROLE.
    function setTreasury(address newTreasury) external onlyRole(MANAGER_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getOffRamp(bytes32 referenceId) external view returns (OffRampDeposit memory) {
        return _offRamps[referenceId];
    }

    function getOnRamp(bytes32 referenceId) external view returns (OnRampRecord memory) {
        return _onRamps[referenceId];
    }

    // ─── UUPS ───────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}

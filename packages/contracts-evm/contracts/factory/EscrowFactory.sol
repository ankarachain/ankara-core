// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../escrow/MilestoneEscrow.sol";

/**
 * @title EscrowFactory
 * @author Cranebolt Technologies — Ankara Chain SDK
 * @notice Deploys MilestoneEscrow contracts via upgradeable proxies.
 *
 * Pattern:
 * 1. Owner registers the MilestoneEscrow implementation address
 * 2. Owner whitelists accepted stablecoins — deposits are restricted to this list
 * 3. Developer calls deployEscrow() with payer, payee, optional arbiter, and milestones
 * 4. Factory deploys an ERC1967 proxy pointing at the implementation
 * 5. Protocol fee optionally collected (0 during testnet)
 */
contract EscrowFactory is Ownable {

    // ─── State ──────────────────────────────────────────────────────────────
    address public implementation;
    mapping(address => bool) public acceptedStablecoins;

    uint256 public deploymentFee;
    address public feeRecipient;

    address[] public allDeployedEscrows;
    mapping(address => address[]) public deployerEscrows;

    // ─── Events ─────────────────────────────────────────────────────────────
    event ImplementationUpdated(address indexed oldImplementation, address indexed newImplementation);
    event StablecoinAccepted(address indexed token, bool accepted);
    event EscrowDeployed(
        address indexed escrowAddress,
        address indexed deployer,
        address payer,
        address payee,
        address token,
        uint256 totalAmount,
        uint256 timestamp
    );
    event DeploymentFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error ImplementationNotSet();
    error StablecoinNotAccepted(address token);
    error InsufficientFee(uint256 required, uint256 provided);
    error ZeroAddress();

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(address initialOwner, address feeRecipient_) Ownable(initialOwner) {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeRecipient  = feeRecipient_;
        deploymentFee = 0;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function setImplementation(address newImplementation) external onlyOwner {
        if (newImplementation == address(0)) revert ZeroAddress();
        emit ImplementationUpdated(implementation, newImplementation);
        implementation = newImplementation;
    }

    /// @notice Whitelist or de-whitelist an ERC-20 token as an accepted escrow currency.
    function setStablecoinAccepted(address token, bool accepted) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        acceptedStablecoins[token] = accepted;
        emit StablecoinAccepted(token, accepted);
    }

    function setDeploymentFee(uint256 newFee) external onlyOwner {
        emit DeploymentFeeUpdated(deploymentFee, newFee);
        deploymentFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function withdrawFees() external onlyOwner {
        (bool ok,) = payable(feeRecipient).call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }

    // ─── Deploy ─────────────────────────────────────────────────────────────

    /**
     * @notice Deploy a new MilestoneEscrow for a payer/payee deal.
     * @param admin_             Address granted admin roles on the new escrow (typically the integrating platform).
     * @param payer_             The diaspora buyer funding the escrow.
     * @param payee_             The recipient of released milestone funds.
     * @param arbiter_           Optional dispute resolver; address(0) disables arbiter-based resolution.
     * @param token_             Stablecoin used for deposits — must be whitelisted via setStablecoinAccepted().
     * @param identityVerifier_  Optional KYC hook; address(0) disables identity gating.
     * @param timelockDuration_  Seconds after a milestone is marked delivered before payee can force-release.
     * @param amounts_           Per-milestone amounts, in token decimals.
     * @param descriptionHashes_ Per-milestone description hash, same length as amounts_.
     */
    function deployEscrow(
        address admin_,
        address payer_,
        address payee_,
        address arbiter_,
        address token_,
        address identityVerifier_,
        uint256 timelockDuration_,
        uint256[] calldata amounts_,
        bytes32[] calldata descriptionHashes_
    ) external payable returns (address escrowAddress) {
        _collectFee();
        if (implementation == address(0)) revert ImplementationNotSet();
        if (!acceptedStablecoins[token_]) revert StablecoinNotAccepted(token_);

        bytes memory initData = abi.encodeCall(
            MilestoneEscrow.initialize,
            (admin_, payer_, payee_, arbiter_, token_, identityVerifier_, timelockDuration_, amounts_, descriptionHashes_)
        );
        escrowAddress = address(new ERC1967Proxy(implementation, initData));

        allDeployedEscrows.push(escrowAddress);
        deployerEscrows[msg.sender].push(escrowAddress);

        uint256 total;
        for (uint256 i = 0; i < amounts_.length; i++) total += amounts_[i];

        emit EscrowDeployed(escrowAddress, msg.sender, payer_, payee_, token_, total, block.timestamp);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function totalDeployedEscrows() external view returns (uint256) {
        return allDeployedEscrows.length;
    }

    function getDeployerEscrows(address deployer) external view returns (address[] memory) {
        return deployerEscrows[deployer];
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _collectFee() internal {
        if (msg.value < deploymentFee) revert InsufficientFee(deploymentFee, msg.value);
    }
}

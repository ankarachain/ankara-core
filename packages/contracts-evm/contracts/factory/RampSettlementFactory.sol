// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../ramp/RampSettlement.sol";

/**
 * @title RampSettlementFactory
 * @author PIE Drops Studio — Ankara Chain SDK
 * @notice Deploys RampSettlement contracts via upgradeable proxies.
 *
 * Pattern:
 * 1. Owner registers the RampSettlement implementation address
 * 2. Developer calls deployRampSettlement() with an admin and treasury address
 * 3. Factory deploys an ERC1967 proxy pointing at the implementation
 * 4. Protocol fee optionally collected (0 during testnet)
 */
contract RampSettlementFactory is Ownable {

    // ─── State ──────────────────────────────────────────────────────────────
    address public implementation;

    uint256 public deploymentFee;
    address public feeRecipient;

    address[] public allDeployedRampSettlements;
    mapping(address => address[]) public deployerRampSettlements;

    // ─── Events ─────────────────────────────────────────────────────────────
    event ImplementationUpdated(address indexed oldImplementation, address indexed newImplementation);
    event RampSettlementDeployed(
        address indexed settlementAddress,
        address indexed deployer,
        address admin,
        address treasury,
        uint256 timestamp
    );
    event DeploymentFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error ImplementationNotSet();
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
     * @notice Deploy a new RampSettlement contract.
     * @param admin_    Address granted admin roles on the new contract.
     * @param treasury_ Address that receives settled off-ramp deposits.
     */
    function deployRampSettlement(
        address admin_,
        address treasury_
    ) external payable returns (address settlementAddress) {
        _collectFee();
        if (implementation == address(0)) revert ImplementationNotSet();

        bytes memory initData = abi.encodeCall(RampSettlement.initialize, (admin_, treasury_));
        settlementAddress = address(new ERC1967Proxy(implementation, initData));

        allDeployedRampSettlements.push(settlementAddress);
        deployerRampSettlements[msg.sender].push(settlementAddress);

        emit RampSettlementDeployed(settlementAddress, msg.sender, admin_, treasury_, block.timestamp);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function totalDeployedRampSettlements() external view returns (uint256) {
        return allDeployedRampSettlements.length;
    }

    function getDeployerRampSettlements(address deployer) external view returns (address[] memory) {
        return deployerRampSettlements[deployer];
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _collectFee() internal {
        if (msg.value < deploymentFee) revert InsufficientFee(deploymentFee, msg.value);
    }
}

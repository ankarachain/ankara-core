// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../templates/CommodityBatchToken.sol";
import "../templates/PoolVault.sol";

/**
 * @title MultiTokenFactory
 * @author PIE Drops Studio — Ankara Chain SDK
 * @notice Deploys Ankara Chain ERC-1155 and Pool multi-token templates via upgradeable proxies.
 *
 * Supported templates:
 * - COMMODITY_BATCH — CommodityBatchToken (ERC-1155 warehouse receipt)
 * - POOL_VAULT      — PoolVault (ERC-20 multi-asset fund)
 *
 * Pattern:
 * 1. Owner registers implementation address per template
 * 2. Developer calls deploy[Template]()
 * 3. Factory deploys ERC1967 proxy pointing at implementation
 * 4. Developer's admin_ address gets full control of the deployed contract
 * 5. Protocol fee optionally collected (0 during testnet)
 */
contract MultiTokenFactory is Ownable {

    // ─── Template enum ──────────────────────────────────────────────────────
    enum MultiTokenTemplate {
        COMMODITY_BATCH,  // 0 — CommodityBatchToken (ERC-1155)
        POOL_VAULT        // 1 — PoolVault (ERC-20 pool token)
    }

    // ─── State ──────────────────────────────────────────────────────────────
    mapping(MultiTokenTemplate => address) public implementations;

    uint256 public deploymentFee;
    address public feeRecipient;

    address[] public allDeployedMultiTokens;
    mapping(address => address[]) public deployerMultiTokens;

    // ─── Events ─────────────────────────────────────────────────────────────
    event MultiTokenTemplateRegistered(
        MultiTokenTemplate indexed template,
        address indexed implementation
    );
    event MultiTokenDeployed(
        MultiTokenTemplate indexed template,
        address indexed contractAddress,
        address indexed deployer,
        bytes32 assetId,
        string  countryCode,
        uint256 timestamp
    );
    event DeploymentFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error TemplateNotRegistered(MultiTokenTemplate template);
    error InsufficientFee(uint256 required, uint256 provided);
    error ZeroAddress();

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(address initialOwner, address feeRecipient_)
        Ownable(initialOwner)
    {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeRecipient  = feeRecipient_;
        deploymentFee = 0;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function registerTemplate(MultiTokenTemplate template, address implementation)
        external onlyOwner
    {
        if (implementation == address(0)) revert ZeroAddress();
        implementations[template] = implementation;
        emit MultiTokenTemplateRegistered(template, implementation);
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

    // ─── Deploy: CommodityBatchToken ────────────────────────────────────────

    /**
     * @notice Deploy a new CommodityBatchToken (ERC-1155) for a warehouse operator.
     * @param name_        Contract name (e.g. "Lagos Cocoa Warehouse").
     * @param countryCode_ ISO 3166-1 alpha-2 country code (e.g. "NG").
     * @param baseURI_     Base IPFS URI for token metadata.
     * @param admin_       Address that receives all roles.
     * @param warehouse_   Warehouse metadata struct.
     */
    function deployCommodityBatchToken(
        string memory name_,
        string memory countryCode_,
        string memory baseURI_,
        address admin_,
        CommodityBatchToken.WarehouseMetadata memory warehouse_
    ) external payable returns (address contractAddress) {
        contractAddress = _deploy(
            MultiTokenTemplate.COMMODITY_BATCH,
            abi.encodeCall(
                CommodityBatchToken.initialize,
                (name_, countryCode_, baseURI_, admin_, warehouse_)
            ),
            bytes32(0),   // CommodityBatchToken has no single assetId (multi-token)
            countryCode_
        );
    }

    // ─── Deploy: PoolVault ──────────────────────────────────────────────────

    /**
     * @notice Deploy a new PoolVault (ERC-20 pool token).
     * @param name_              Pool token name (e.g. "West Africa Commodity Pool").
     * @param symbol_            Pool token symbol (e.g. "WACP").
     * @param assetId_           Unique bytes32 asset identifier.
     * @param countryCode_       ISO 3166-1 alpha-2 country code.
     * @param admin_             Address that receives all roles.
     * @param verifier_          Optional identity verifier (address(0) = open).
     * @param oracle_            IAnkaraOracle price feed (address(0) to configure later).
     * @param managementFeeBps_  Annual management fee in bps (0 → defaults to 50 = 0.5%).
     */
    function deployPoolVault(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_,
        address oracle_,
        uint256 managementFeeBps_
    ) external payable returns (address contractAddress) {
        contractAddress = _deploy(
            MultiTokenTemplate.POOL_VAULT,
            abi.encodeCall(
                PoolVault.initialize,
                (name_, symbol_, assetId_, countryCode_, admin_, verifier_, feeRecipient, oracle_, managementFeeBps_)
            ),
            assetId_,
            countryCode_
        );
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function totalDeployedMultiTokens() external view returns (uint256) {
        return allDeployedMultiTokens.length;
    }

    function getDeployerMultiTokens(address deployer)
        external view returns (address[] memory)
    {
        return deployerMultiTokens[deployer];
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _deploy(
        MultiTokenTemplate template,
        bytes memory initData,
        bytes32 assetId_,
        string memory countryCode_
    ) internal returns (address contractAddress) {
        _collectFee();
        address impl = implementations[template];
        if (impl == address(0)) revert TemplateNotRegistered(template);

        contractAddress = address(new ERC1967Proxy(impl, initData));
        allDeployedMultiTokens.push(contractAddress);
        deployerMultiTokens[msg.sender].push(contractAddress);

        emit MultiTokenDeployed(
            template, contractAddress, msg.sender,
            assetId_, countryCode_, block.timestamp
        );
    }

    function _collectFee() internal {
        if (msg.value < deploymentFee) {
            revert InsufficientFee(deploymentFee, msg.value);
        }
    }
}

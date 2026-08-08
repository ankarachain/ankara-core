// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../templates/FarmlandToken.sol";
import "../templates/CommodityReceiptToken.sol";
import "../templates/RealEstateToken.sol";
import "../templates/InvoiceToken.sol";
import "../templates/CarbonCreditToken.sol";
import "../templates/MiningRightsToken.sol";

/**
 * @title TokenFactory
 * @author PIE Drops Studio — Ankara Chain SDK
 * @notice Deploys all Ankara Chain RWA token templates via upgradeable proxies.
 *
 * Supports all 6 African asset class templates:
 * FARMLAND, COMMODITY_RECEIPT, REAL_ESTATE, INVOICE, CARBON_CREDIT, MINING_RIGHTS
 *
 * Pattern:
 * 1. Owner registers implementation address per template
 * 2. Developer calls deploy[Template]Token()
 * 3. Factory deploys ERC1967 proxy pointing at implementation
 * 4. Developer's admin_ address gets full control of the new token
 * 5. Protocol fee optionally collected (0 during testnet)
 */
contract TokenFactory is Ownable {

    // ─── Template enum ──────────────────────────────────────────────────────
    enum Template {
        FARMLAND,           // 0
        COMMODITY_RECEIPT,  // 1
        REAL_ESTATE,        // 2
        INVOICE,            // 3
        CARBON_CREDIT,      // 4
        MINING_RIGHTS       // 5
    }

    // ─── State ──────────────────────────────────────────────────────────────
    mapping(Template => address) public implementations;

    uint256 public deploymentFee;
    address public feeRecipient;

    address[] public allDeployedTokens;
    mapping(address => address[]) public deployerTokens;

    // ─── Events ─────────────────────────────────────────────────────────────
    event TemplateRegistered(Template indexed template, address indexed implementation);
    event TokenDeployed(
        Template indexed template,
        address indexed tokenAddress,
        address indexed deployer,
        bytes32 assetId,
        string  countryCode,
        uint256 timestamp
    );
    event DeploymentFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error TemplateNotRegistered(Template template);
    error InsufficientFee(uint256 required, uint256 provided);
    error ZeroAddress();

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(address initialOwner, address feeRecipient_)
        Ownable(initialOwner)
    {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeRecipient   = feeRecipient_;
        deploymentFee  = 0;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function registerTemplate(Template template, address implementation)
        external onlyOwner
    {
        if (implementation == address(0)) revert ZeroAddress();
        implementations[template] = implementation;
        emit TemplateRegistered(template, implementation);
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

    // ─── Deploy: Farmland ───────────────────────────────────────────────────

    function deployFarmlandToken(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_,
        FarmlandToken.FarmlandMetadata memory metadata_
    ) external payable returns (address tokenAddress) {
        tokenAddress = _deploy(Template.FARMLAND, abi.encodeCall(
            FarmlandToken.initialize,
            (name_, symbol_, assetId_, country_, admin_, verifier_, feeRecipient, metadata_)
        ), assetId_, country_);
    }

    // ─── Deploy: Commodity Receipt ───────────────────────────────────────────

    function deployCommodityReceiptToken(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_,
        CommodityReceiptToken.CommodityMetadata memory metadata_
    ) external payable returns (address tokenAddress) {
        tokenAddress = _deploy(Template.COMMODITY_RECEIPT, abi.encodeCall(
            CommodityReceiptToken.initialize,
            (name_, symbol_, assetId_, country_, admin_, verifier_, feeRecipient, metadata_)
        ), assetId_, country_);
    }

    // ─── Deploy: Real Estate ─────────────────────────────────────────────────

    function deployRealEstateToken(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_,
        RealEstateToken.RealEstateMetadata memory metadata_
    ) external payable returns (address tokenAddress) {
        tokenAddress = _deploy(Template.REAL_ESTATE, abi.encodeCall(
            RealEstateToken.initialize,
            (name_, symbol_, assetId_, country_, admin_, verifier_, feeRecipient, metadata_)
        ), assetId_, country_);
    }

    // ─── Deploy: Invoice ─────────────────────────────────────────────────────

    function deployInvoiceToken(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_,
        InvoiceToken.InvoiceMetadata memory metadata_
    ) external payable returns (address tokenAddress) {
        tokenAddress = _deploy(Template.INVOICE, abi.encodeCall(
            InvoiceToken.initialize,
            (name_, symbol_, assetId_, country_, admin_, verifier_, feeRecipient, metadata_)
        ), assetId_, country_);
    }

    // ─── Deploy: Carbon Credit ───────────────────────────────────────────────

    function deployCarbonCreditToken(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_,
        CarbonCreditToken.CarbonCreditMetadata memory metadata_
    ) external payable returns (address tokenAddress) {
        tokenAddress = _deploy(Template.CARBON_CREDIT, abi.encodeCall(
            CarbonCreditToken.initialize,
            (name_, symbol_, assetId_, country_, admin_, verifier_, feeRecipient, metadata_)
        ), assetId_, country_);
    }

    // ─── Deploy: Mining Rights ───────────────────────────────────────────────

    function deployMiningRightsToken(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_,
        MiningRightsToken.MiningRightsMetadata memory metadata_
    ) external payable returns (address tokenAddress) {
        tokenAddress = _deploy(Template.MINING_RIGHTS, abi.encodeCall(
            MiningRightsToken.initialize,
            (name_, symbol_, assetId_, country_, admin_, verifier_, feeRecipient, metadata_)
        ), assetId_, country_);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function totalDeployed() external view returns (uint256) {
        return allDeployedTokens.length;
    }

    function getDeployerTokens(address deployer)
        external view returns (address[] memory)
    {
        return deployerTokens[deployer];
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _deploy(
        Template template,
        bytes memory initData,
        bytes32 assetId_,
        string memory country_
    ) internal returns (address tokenAddress) {
        _collectFee();
        address impl = implementations[template];
        if (impl == address(0)) revert TemplateNotRegistered(template);

        tokenAddress = address(new ERC1967Proxy(impl, initData));
        allDeployedTokens.push(tokenAddress);
        deployerTokens[msg.sender].push(tokenAddress);

        emit TokenDeployed(
            template, tokenAddress, msg.sender,
            assetId_, country_, block.timestamp
        );
    }

    function _collectFee() internal {
        if (msg.value < deploymentFee) {
            revert InsufficientFee(deploymentFee, msg.value);
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../templates/FarmlandToken.sol";
import "../templates/CommodityReceiptToken.sol";

/**
 * @title TokenFactory
 * @author Cranebolt Technologies
 * @notice Deploys Ankara Chain RWA tokens from pre-audited templates via proxy clones.
 *
 * How it works:
 * 1. Owner registers implementation contracts per template type
 * 2. Developers call deployFarmlandToken / deployCommodityReceiptToken
 * 3. Factory deploys an ERC1967 upgradeable proxy pointing at the implementation
 * 4. Developer's admin_ address gets full control of the new token
 * 5. Protocol fee optionally collected on each deployment (0 during testnet)
 */
contract TokenFactory is Ownable {

    // ─── Template enum ──────────────────────────────────────────────────────
    enum Template { FARMLAND, COMMODITY_RECEIPT }

    // ─── State ──────────────────────────────────────────────────────────────
    mapping(Template => address) public implementations;

    uint256 public deploymentFee;   // In wei — 0 during testnet
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
        string countryCode,
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
        feeRecipient = feeRecipient_;
        deploymentFee = 0; // Free during testnet / early adoption phase
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function registerTemplate(Template template, address implementation)
        external
        onlyOwner
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

    /**
     * @notice Deploy a new FarmlandToken
     * @param name_       Token name — e.g. "Kano Farmland Token"
     * @param symbol_     Token symbol — e.g. "KFT"
     * @param assetId_    Unique identifier for this land parcel (bytes32)
     * @param country_    ISO 3166-1 alpha-2 — e.g. "NG", "GH", "KE"
     * @param admin_      Gets all roles on the new token (minter, manager, etc.)
     * @param verifier_   Identity verifier address (address(0) = no KYC)
     * @param metadata_   Initial farmland metadata struct
     * @return tokenAddress  Deployed proxy address
     */
    function deployFarmlandToken(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_,
        FarmlandToken.FarmlandMetadata memory metadata_
    ) external payable returns (address tokenAddress) {
        _collectFee();

        address impl = implementations[Template.FARMLAND];
        if (impl == address(0)) revert TemplateNotRegistered(Template.FARMLAND);

        bytes memory data = abi.encodeCall(
            FarmlandToken.initialize,
            (name_, symbol_, assetId_, country_, admin_, verifier_, feeRecipient, metadata_)
        );

        tokenAddress = address(new ERC1967Proxy(impl, data));

        allDeployedTokens.push(tokenAddress);
        deployerTokens[msg.sender].push(tokenAddress);

        emit TokenDeployed(
            Template.FARMLAND, tokenAddress, msg.sender,
            assetId_, country_, block.timestamp
        );
    }

    // ─── Deploy: Commodity Receipt ───────────────────────────────────────────

    /**
     * @notice Deploy a new CommodityReceiptToken
     */
    function deployCommodityReceiptToken(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_,
        CommodityReceiptToken.CommodityMetadata memory metadata_
    ) external payable returns (address tokenAddress) {
        _collectFee();

        address impl = implementations[Template.COMMODITY_RECEIPT];
        if (impl == address(0)) revert TemplateNotRegistered(Template.COMMODITY_RECEIPT);

        bytes memory data = abi.encodeCall(
            CommodityReceiptToken.initialize,
            (name_, symbol_, assetId_, country_, admin_, verifier_, feeRecipient, metadata_)
        );

        tokenAddress = address(new ERC1967Proxy(impl, data));

        allDeployedTokens.push(tokenAddress);
        deployerTokens[msg.sender].push(tokenAddress);

        emit TokenDeployed(
            Template.COMMODITY_RECEIPT, tokenAddress, msg.sender,
            assetId_, country_, block.timestamp
        );
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function totalDeployed() external view returns (uint256) {
        return allDeployedTokens.length;
    }

    function getDeployerTokens(address deployer)
        external
        view
        returns (address[] memory)
    {
        return deployerTokens[deployer];
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _collectFee() internal {
        if (msg.value < deploymentFee) {
            revert InsufficientFee(deploymentFee, msg.value);
        }
    }
}

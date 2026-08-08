// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../templates/FarmlandNFT.sol";
import "../templates/RealEstateNFT.sol";
import "../templates/MiningRightsNFT.sol";
import "../templates/CommodityVaultNFT.sol";

/**
 * @title NFTFactory
 * @author PIE Drops Studio — Ankara Chain SDK
 * @notice Deploys all Ankara Chain NFT asset record templates via upgradeable proxies.
 *
 * Supports 4 NFT templates:
 * FARMLAND, REAL_ESTATE, MINING_RIGHTS, COMMODITY_VAULT
 *
 * Pattern:
 * 1. Owner registers implementation address per template
 * 2. Developer calls deploy[Template]NFT()
 * 3. Factory deploys ERC1967 proxy pointing at implementation
 * 4. Developer's admin_ address gets full control of the new NFT contract
 * 5. Protocol fee optionally collected (0 during testnet)
 */
contract NFTFactory is Ownable {

    // ─── Template enum ──────────────────────────────────────────────────────
    enum NFTTemplate {
        FARMLAND,        // 0
        REAL_ESTATE,     // 1
        MINING_RIGHTS,   // 2
        COMMODITY_VAULT  // 3
    }

    // ─── State ──────────────────────────────────────────────────────────────
    mapping(NFTTemplate => address) public implementations;

    uint256 public deploymentFee;
    address public feeRecipient;

    address[] public allDeployedNFTs;
    mapping(address => address[]) public deployerNFTs;

    // ─── Events ─────────────────────────────────────────────────────────────
    event NFTTemplateRegistered(NFTTemplate indexed template, address indexed implementation);
    event NFTDeployed(
        NFTTemplate indexed template,
        address indexed nftAddress,
        address indexed deployer,
        bytes32 assetId,
        string  countryCode,
        uint256 timestamp
    );
    event DeploymentFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error TemplateNotRegistered(NFTTemplate template);
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

    function registerTemplate(NFTTemplate template, address implementation)
        external onlyOwner
    {
        if (implementation == address(0)) revert ZeroAddress();
        implementations[template] = implementation;
        emit NFTTemplateRegistered(template, implementation);
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

    // ─── Deploy: Farmland NFT ────────────────────────────────────────────────

    function deployFarmlandNFT(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_
    ) external payable returns (address nftAddress) {
        nftAddress = _deployNFT(
            NFTTemplate.FARMLAND,
            abi.encodeCall(FarmlandNFT.initialize, (name_, symbol_, assetId_, country_, admin_, verifier_)),
            assetId_,
            country_
        );
    }

    // ─── Deploy: Real Estate NFT ─────────────────────────────────────────────

    function deployRealEstateNFT(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_
    ) external payable returns (address nftAddress) {
        nftAddress = _deployNFT(
            NFTTemplate.REAL_ESTATE,
            abi.encodeCall(RealEstateNFT.initialize, (name_, symbol_, assetId_, country_, admin_, verifier_)),
            assetId_,
            country_
        );
    }

    // ─── Deploy: Mining Rights NFT ───────────────────────────────────────────

    function deployMiningRightsNFT(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_
    ) external payable returns (address nftAddress) {
        nftAddress = _deployNFT(
            NFTTemplate.MINING_RIGHTS,
            abi.encodeCall(MiningRightsNFT.initialize, (name_, symbol_, assetId_, country_, admin_, verifier_)),
            assetId_,
            country_
        );
    }

    // ─── Deploy: Commodity Vault NFT ─────────────────────────────────────────

    function deployCommodityVaultNFT(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory country_,
        address admin_,
        address verifier_
    ) external payable returns (address nftAddress) {
        nftAddress = _deployNFT(
            NFTTemplate.COMMODITY_VAULT,
            abi.encodeCall(CommodityVaultNFT.initialize, (name_, symbol_, assetId_, country_, admin_, verifier_)),
            assetId_,
            country_
        );
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function totalDeployedNFTs() external view returns (uint256) {
        return allDeployedNFTs.length;
    }

    function getDeployerNFTs(address deployer)
        external view returns (address[] memory)
    {
        return deployerNFTs[deployer];
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _deployNFT(
        NFTTemplate template,
        bytes memory initData,
        bytes32 assetId_,
        string memory country_
    ) internal returns (address nftAddress) {
        _collectFee();
        address impl = implementations[template];
        if (impl == address(0)) revert TemplateNotRegistered(template);

        nftAddress = address(new ERC1967Proxy(impl, initData));
        allDeployedNFTs.push(nftAddress);
        deployerNFTs[msg.sender].push(nftAddress);

        emit NFTDeployed(
            template, nftAddress, msg.sender,
            assetId_, country_, block.timestamp
        );
    }

    function _collectFee() internal {
        if (msg.value < deploymentFee) {
            revert InsufficientFee(deploymentFee, msg.value);
        }
    }
}

/**
 * Minimal ABIs for Ankara Chain contracts.
 * Full ABIs are auto-generated in contracts-evm/typechain-types.
 * These minimal ABIs are bundled in the SDK for runtime use.
 */

export const TOKEN_FACTORY_ABI = [
  "function deployFarmlandToken(string name, string symbol, bytes32 assetId, string country, address admin, address verifier, tuple(string location, uint256 areaSqMeters, string soilType, string irrigationType, string cropHistory, bytes32 titleDocumentHash, uint256 valuationUSD, string stateRegion, uint256 lastUpdated) metadata) payable returns (address)",
  "function deployCommodityReceiptToken(string name, string symbol, bytes32 assetId, string country, address admin, address verifier, tuple(string commodityType, uint256 quantityKg, string gradeClassification, string warehouseId, string warehouseLocation, uint256 depositDate, uint256 expiryDate, bytes32 inspectionReportHash, uint256 valuationUSD, string harvestSeason, uint256 lastUpdated) metadata) payable returns (address)",
  "function registerTemplate(uint8 template, address implementation) external",
  "function totalDeployed() view returns (uint256)",
  "function getDeployerTokens(address deployer) view returns (address[])",
  "function deploymentFee() view returns (uint256)",
  "function implementations(uint8) view returns (address)",
  "event TokenDeployed(uint8 indexed template, address indexed tokenAddress, address indexed deployer, bytes32 assetId, string countryCode, uint256 timestamp)",
] as const;

export const FARMLAND_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function mint(address to, uint256 amount) external",
  "function burn(uint256 amount) external",
  "function pause() external",
  "function unpause() external",
  "function assetId() view returns (bytes32)",
  "function countryCode() view returns (string)",
  "function status() view returns (uint8)",
  "function identityVerifier() view returns (address)",
  "function setStatus(uint8 newStatus) external",
  "function setIdentityVerifier(address verifier) external",
  "function getMetadata() view returns (tuple(string location, uint256 areaSqMeters, string soilType, string irrigationType, string cropHistory, bytes32 titleDocumentHash, uint256 valuationUSD, string stateRegion, uint256 lastUpdated))",
  "function valuationUSD() view returns (uint256)",
  "function areaSqMeters() view returns (uint256)",
  "function metadataVersion() view returns (uint256)",
  "function updateValuation(uint256 newValuationUSD) external",
  "function updateTitleDocument(bytes32 newHash) external",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event MetadataUpdated(uint256 indexed version, uint256 timestamp)",
  "event AssetStatusChanged(uint8 indexed oldStatus, uint8 indexed newStatus, uint256 timestamp)",
] as const;

export const COMMODITY_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) external",
  "function burn(uint256 amount) external",
  "function pause() external",
  "function unpause() external",
  "function assetId() view returns (bytes32)",
  "function countryCode() view returns (string)",
  "function status() view returns (uint8)",
  "function identityVerifier() view returns (address)",
  "function setStatus(uint8 newStatus) external",
  "function getMetadata() view returns (tuple(string commodityType, uint256 quantityKg, string gradeClassification, string warehouseId, string warehouseLocation, uint256 depositDate, uint256 expiryDate, bytes32 inspectionReportHash, uint256 valuationUSD, string harvestSeason, uint256 lastUpdated))",
  "function commodityType() view returns (string)",
  "function quantityKg() view returns (uint256)",
  "function valuationUSD() view returns (uint256)",
  "function isExpired() view returns (bool)",
  "function metadataVersion() view returns (uint256)",
  "function markExpired() external",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event MetadataUpdated(uint256 indexed version, uint256 timestamp)",
] as const;

export const WHITELIST_VERIFIER_ABI = [
  "function isVerified(address account) view returns (bool)",
  "function verifyIdentity(address account) external",
  "function revokeIdentity(address account) external",
  "function batchVerify(address[] accounts) external",
  "function verifierName() view returns (string)",
  "event IdentityVerified(address indexed account, uint256 timestamp)",
  "event IdentityRevoked(address indexed account, uint256 timestamp)",
] as const;

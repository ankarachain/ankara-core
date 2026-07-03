// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../base/AnkaraChainBaseToken.sol";
import "../interfaces/IAnkaraOracle.sol";

/**
 * @title PoolVault
 * @author Cranebolt Technologies
 * @notice Ankara Chain ERC-20 template — on-chain multi-asset fund manager.
 *
 * The vault itself is an ERC-20 token (pool tokens = proportional ownership shares).
 * Investors deposit accepted Ankara ERC-20 tokens and receive pool tokens priced
 * at current NAV. On withdrawal, pool tokens are burned and the proportional basket
 * of underlying assets is returned.
 *
 * Architecture:
 * - Inherits AnkaraChainBaseToken (ERC-20 with roles, verifier, UUPS, status)
 * - Oracle-priced NAV via pluggable IAnkaraOracle (ManualOracle for MVP)
 * - Up to 50 accepted ERC-20 tokens per vault
 * - Annual management fee accrual (basis points, default 50 = 0.5%)
 * - Emergency pause halts deposits + withdrawals
 *
 * Use cases:
 * - Diversified commodity basket (cocoa + coffee + maize)
 * - Multi-asset real estate fund
 * - Liquidity pool for cross-asset DeFi strategies
 *
 * Deploy via MultiTokenFactory. Never deploy directly.
 */
contract PoolVault is AnkaraChainBaseToken {
    using SafeERC20 for IERC20;

    // ─── Constants ─────────────────────────────────────────────────────────
    uint256 public constant MAX_TOKENS_PER_VAULT = 50;
    uint256 private constant YEAR_IN_SECONDS     = 365 days;

    // ─── State ─────────────────────────────────────────────────────────────

    // Accepted token registry
    address[] private _acceptedTokens;
    mapping(address => bool)    private _isAccepted;
    mapping(address => uint256) private _tokenWeightsBps;  // target allocation weights (informational)
    mapping(address => uint256) private _minDeposit;       // per-token minimum deposit amount

    // Oracle
    IAnkaraOracle private _oracle;

    // Management fee
    uint256 public managementFeeBps;   // annual fee in basis points (50 = 0.5%)
    uint256 private _lastFeeAccrual;   // unix timestamp of last fee accrual

    // ─── Storage gap ───────────────────────────────────────────────────────
    uint256[50] private __gap;

    // ─── Errors ────────────────────────────────────────────────────────────
    error TokenNotAccepted(address token);
    error TokenAlreadyAccepted(address token);
    error TooManyTokens(uint256 current, uint256 max);
    error BelowMinDeposit(address token, uint256 amount, uint256 minimum);
    error OracleNotSet();
    error OraclePriceStale(address token);
    error ZeroAmount();
    error InsufficientPoolTokens();

    // ─── Events ────────────────────────────────────────────────────────────

    event Deposited(
        address indexed investor,
        address indexed token,
        uint256 amount,
        uint256 poolTokensMinted
    );

    event Withdrawn(
        address indexed investor,
        uint256 poolTokensBurned,
        address[] tokens,
        uint256[] amounts
    );

    event FeeAccrued(uint256 feeTokens, uint256 timestamp);

    event TokenAccepted(address indexed token, uint256 weightBps);
    event TokenRemoved(address indexed token);

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event ManagementFeeBpsUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event MinDepositUpdated(address indexed token, uint256 oldMin, uint256 newMin);

    // ─── Initializer ───────────────────────────────────────────────────────

    /**
     * @param oracle_            Address of IAnkaraOracle price feed (address(0) to configure later).
     * @param managementFeeBps_  Annual management fee in bps (0 → defaults to 50 = 0.5%).
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_,
        address feeRecipient_,
        address oracle_,
        uint256 managementFeeBps_
    ) external initializer {
        __AnkaraChainBaseToken_init(
            name_, symbol_, assetId_, countryCode_,
            admin_, verifier_, feeRecipient_
        );
        if (oracle_ != address(0)) {
            _oracle = IAnkaraOracle(oracle_);
        }
        managementFeeBps = managementFeeBps_ > 0 ? managementFeeBps_ : 50;
        _lastFeeAccrual  = block.timestamp;
    }

    // ─── Token registry ─────────────────────────────────────────────────────

    /**
     * @notice Whitelist an ERC-20 token for deposit into this vault.
     * @dev MANAGER_ROLE. weightBps is informational (target allocation); deposits are
     *      priced by oracle regardless of weight.
     */
    function addAcceptedToken(address token, uint256 weightBps)
        external
        onlyRole(MANAGER_ROLE)
    {
        if (_isAccepted[token]) revert TokenAlreadyAccepted(token);
        if (_acceptedTokens.length >= MAX_TOKENS_PER_VAULT)
            revert TooManyTokens(_acceptedTokens.length, MAX_TOKENS_PER_VAULT);

        _isAccepted[token]       = true;
        _tokenWeightsBps[token]  = weightBps;
        _acceptedTokens.push(token);

        emit TokenAccepted(token, weightBps);
    }

    /**
     * @notice Remove a token from the accepted list.
     * @dev MANAGER_ROLE. Existing vault holdings of this token are unaffected —
     *      they remain and are still returned proportionally on withdrawal.
     */
    function removeAcceptedToken(address token) external onlyRole(MANAGER_ROLE) {
        if (!_isAccepted[token]) revert TokenNotAccepted(token);

        _isAccepted[token]      = false;
        _tokenWeightsBps[token] = 0;

        // Swap-and-pop to remove from array
        uint256 len = _acceptedTokens.length;
        for (uint256 i = 0; i < len; i++) {
            if (_acceptedTokens[i] == token) {
                _acceptedTokens[i] = _acceptedTokens[len - 1];
                _acceptedTokens.pop();
                break;
            }
        }

        emit TokenRemoved(token);
    }

    // ─── Configuration ──────────────────────────────────────────────────────

    /// @notice Swap the oracle price feed. MANAGER_ROLE.
    function setOracle(address oracle_) external onlyRole(MANAGER_ROLE) {
        address old = address(_oracle);
        _oracle = IAnkaraOracle(oracle_);
        emit OracleUpdated(old, oracle_);
    }

    /// @notice Update the annual management fee in basis points. MANAGER_ROLE.
    function setManagementFeeBps(uint256 newFeeBps) external onlyRole(MANAGER_ROLE) {
        uint256 old = managementFeeBps;
        managementFeeBps = newFeeBps;
        emit ManagementFeeBpsUpdated(old, newFeeBps);
    }

    /// @notice Set the minimum deposit amount for a specific token. MANAGER_ROLE.
    function setMinDeposit(address token, uint256 minAmount)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 old = _minDeposit[token];
        _minDeposit[token] = minAmount;
        emit MinDepositUpdated(token, old, minAmount);
    }

    // ─── Deposit ────────────────────────────────────────────────────────────

    /**
     * @notice Deposit `amount` of an accepted ERC-20 token and receive pool tokens.
     * @dev Pool tokens minted = deposit USD value / current NAV per token.
     *      Caller must approve this contract to transfer `tokenAddress`.
     *      Reverts if oracle price is stale.
     */
    function deposit(address tokenAddress, uint256 amount) external whenNotPaused {
        if (!_isAccepted[tokenAddress])  revert TokenNotAccepted(tokenAddress);
        if (amount == 0)                 revert ZeroAmount();

        uint256 minDep = _minDeposit[tokenAddress];
        if (minDep > 0 && amount < minDep)
            revert BelowMinDeposit(tokenAddress, amount, minDep);

        if (address(_oracle) == address(0)) revert OracleNotSet();
        if (_oracle.isStale(tokenAddress))  revert OraclePriceStale(tokenAddress);

        uint256 poolTokensMinted = _calculateMintAmount(tokenAddress, amount);

        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, poolTokensMinted);

        emit Deposited(msg.sender, tokenAddress, amount, poolTokensMinted);
    }

    // ─── Withdrawal ─────────────────────────────────────────────────────────

    /**
     * @notice Burn pool tokens and receive a proportional basket of underlying tokens.
     * @dev Pool tokens burned BEFORE transfers (re-entrancy protection).
     *      Proportions calculated against pre-burn supply.
     */
    function withdraw(uint256 poolTokenAmount) external whenNotPaused {
        if (poolTokenAmount == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < poolTokenAmount) revert InsufficientPoolTokens();

        uint256 supplyBefore = totalSupply();
        address[] memory tokens  = _acceptedTokens;
        uint256[] memory amounts = new uint256[](tokens.length);

        // Compute proportional amounts before burning
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 vaultBal = IERC20(tokens[i]).balanceOf(address(this));
            amounts[i] = (vaultBal * poolTokenAmount) / supplyBefore;
        }

        // Burn first — prevents re-entrancy on subsequent transfers
        _burn(msg.sender, poolTokenAmount);

        // Transfer proportional basket
        for (uint256 i = 0; i < tokens.length; i++) {
            if (amounts[i] > 0) {
                IERC20(tokens[i]).safeTransfer(msg.sender, amounts[i]);
            }
        }

        emit Withdrawn(msg.sender, poolTokenAmount, tokens, amounts);
    }

    // ─── Management fee accrual ─────────────────────────────────────────────

    /**
     * @notice Accrue the management fee based on elapsed time.
     * @dev Callable by anyone. Mints fee tokens directly to `feeRecipient`.
     *      Fee = totalSupply × managementFeeBps × elapsedSeconds / (10_000 × YEAR_IN_SECONDS).
     */
    function accrueManagementFee() external {
        if (managementFeeBps == 0) return;
        uint256 supply = totalSupply();
        if (supply == 0) return;

        uint256 elapsed = block.timestamp - _lastFeeAccrual;
        if (elapsed == 0) return;

        uint256 feeTokens = (supply * managementFeeBps * elapsed)
            / (10_000 * YEAR_IN_SECONDS);

        _lastFeeAccrual = block.timestamp;

        if (feeTokens > 0) {
            _mint(feeRecipient, feeTokens);
            emit FeeAccrued(feeTokens, block.timestamp);
        }
    }

    // ─── NAV + AUM ──────────────────────────────────────────────────────────

    /**
     * @notice Total USD value of all assets held by this vault.
     * @dev Returns 0 if no oracle is configured. Price precision: 1e18 = $1.00.
     *      AUM = Σ (balance[token] × priceUSD[token]) / 1e18
     */
    function totalAUM() public view returns (uint256 aum) {
        if (address(_oracle) == address(0)) return 0;
        for (uint256 i = 0; i < _acceptedTokens.length; i++) {
            address token = _acceptedTokens[i];
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance == 0) continue;
            (uint256 price,) = _oracle.getPrice(token);
            aum += (balance * price) / 1e18;
        }
    }

    /**
     * @notice Net asset value per pool token in USD (18 decimal precision).
     * @dev Returns 1e18 ($1.00) when pool is empty — sets the initial mint price.
     */
    function NAVPerToken() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (totalAUM() * 1e18) / supply;
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function acceptedTokens()  external view returns (address[] memory) { return _acceptedTokens; }
    function isAccepted(address token) external view returns (bool)      { return _isAccepted[token]; }
    function tokenWeight(address token) external view returns (uint256)  { return _tokenWeightsBps[token]; }
    function minDeposit(address token) external view returns (uint256)   { return _minDeposit[token]; }
    function oracle() external view returns (address)                    { return address(_oracle); }
    function lastFeeAccrual() external view returns (uint256)            { return _lastFeeAccrual; }

    // ─── Internal helpers ───────────────────────────────────────────────────

    /**
     * @dev Calculate pool tokens to mint for a given deposit amount.
     *      First depositor gets 1 pool token per $1 (NAV bootstrap).
     *      Subsequent depositors get tokens proportional to current NAV.
     */
    function _calculateMintAmount(address tokenAddress, uint256 amount)
        internal
        view
        returns (uint256)
    {
        (uint256 price,) = _oracle.getPrice(tokenAddress);
        uint256 valueUSD = (amount * price) / 1e18;

        uint256 supply = totalSupply();
        if (supply == 0) {
            // Bootstrap: 1 pool token = $1 USD
            return valueUSD;
        }
        // poolTokens = valueUSD / NAVPerToken = valueUSD × totalSupply / totalAUM
        uint256 nav = NAVPerToken();
        return (valueUSD * 1e18) / nav;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OutcomeEscrow
 * @notice Pay for a result, not for an attempt.
 *
 * @dev Agent payment rails today settle on a promise. x402 releases funds when a
 *      facilitator returns a success response; the buyer is expected to trust
 *      it. Nothing checks that the work happened, and nothing checks that value
 *      actually moved -- a transaction can mine with status 1, emit no logs,
 *      transfer nothing, and still be recorded as paid.
 *
 *      This contract holds the money until someone proves an outcome, and it
 *      makes the claim itself the unit of accounting rather than the request.
 *
 *      Three properties, in the order they matter:
 *
 *      1. An intent is claimed exactly once. `intentId` is derived by the caller
 *         from the work itself, so two agents that independently decide to do
 *         the same job collide here rather than both paying for it. This is the
 *         on-chain half of an idempotency key: a header can be rotated, a
 *         mapping cannot.
 *
 *      2. Funds sit in escrow between claim and outcome. There is no window in
 *         which the payer has paid and the work is unproven.
 *
 *      3. Release requires a verifier's verdict, and the verifier is expected to
 *         check a balance delta rather than a status byte. The contract cannot
 *         see off-chain work, so it does not pretend to -- it constrains *who*
 *         may attest and guarantees the money follows the attestation.
 *
 *      Deliberately not included: an arbitration DAO, a dispute window with a
 *      challenge game, or an LLM judge. Every one of those adds latency and a
 *      trust assumption to a decision that, for on-chain work, is a lookup.
 */
contract OutcomeEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The token every escrow is denominated in.
    IERC20 public immutable token;

    /// @notice Addresses permitted to attest an outcome.
    mapping(address => bool) public isVerifier;

    /// @notice The account that may add and remove verifiers.
    address public admin;

    enum State {
        None, // never claimed
        Open, // funded, awaiting a verdict
        Released, // work proven, payee paid
        Refunded // work not proven, payer made whole
    }

    struct Intent {
        address payer;
        address payee;
        uint256 amount;
        /// @dev Seconds since epoch after which the payer may self-refund.
        uint64 refundableAt;
        State state;
    }

    mapping(bytes32 => Intent) public intents;

    /// @notice Total currently held across all open intents.
    uint256 public escrowed;

    event Claimed(
        bytes32 indexed intentId,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint64 refundableAt
    );
    event Released(bytes32 indexed intentId, address indexed payee, uint256 amount, bytes32 proof);
    event Refunded(bytes32 indexed intentId, address indexed payer, uint256 amount, string reason);
    event VerifierSet(address indexed verifier, bool allowed);

    error AlreadyClaimed(bytes32 intentId);
    error NotOpen(bytes32 intentId, State state);
    error NotVerifier(address caller);
    error NotAdmin(address caller);
    error NotPayer(address caller);
    error TooEarlyToRefund(uint64 refundableAt, uint64 nowTs);
    error ZeroAmount();
    error ZeroAddress();

    modifier onlyVerifier() {
        if (!isVerifier[msg.sender]) revert NotVerifier(msg.sender);
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    constructor(IERC20 _token, address _admin) {
        if (address(_token) == address(0) || _admin == address(0)) revert ZeroAddress();
        token = _token;
        admin = _admin;
        isVerifier[_admin] = true;
        emit VerifierSet(_admin, true);
    }

    function setVerifier(address verifier, bool allowed) external onlyAdmin {
        if (verifier == address(0)) revert ZeroAddress();
        isVerifier[verifier] = allowed;
        emit VerifierSet(verifier, allowed);
    }

    /**
     * @notice Claim an intent and fund it.
     * @dev The caller derives `intentId` from the work -- typically a hash of
     *      (task, inputs, payee). Deriving it from a nonce or a clock would
     *      defeat the point: two agents asked to do the same job must produce
     *      the same id, so the second one is refused here instead of paying for
     *      a duplicate.
     * @param intentId Content-derived identifier for the work.
     * @param payee Who is paid if the outcome is proven.
     * @param amount Amount held in escrow.
     * @param refundWindow Seconds until the payer may self-refund an unproven
     *        intent. A verifier that goes offline must not be able to strand
     *        funds forever.
     */
    function claim(bytes32 intentId, address payee, uint256 amount, uint64 refundWindow)
        external
        nonReentrant
    {
        if (intents[intentId].state != State.None) revert AlreadyClaimed(intentId);
        if (amount == 0) revert ZeroAmount();
        if (payee == address(0)) revert ZeroAddress();

        uint64 refundableAt = uint64(block.timestamp) + refundWindow;

        intents[intentId] = Intent({
            payer: msg.sender,
            payee: payee,
            amount: amount,
            refundableAt: refundableAt,
            state: State.Open
        });
        escrowed += amount;

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Claimed(intentId, msg.sender, payee, amount, refundableAt);
    }

    /**
     * @notice Attest that the work happened and release the funds.
     * @param proof An opaque commitment to the evidence -- in this system, a
     *        hash of the transaction receipt and the observed balance delta. The
     *        contract does not interpret it; it records it so the release is
     *        auditable against something specific rather than someone's word.
     */
    function release(bytes32 intentId, bytes32 proof) external onlyVerifier nonReentrant {
        Intent storage i = intents[intentId];
        if (i.state != State.Open) revert NotOpen(intentId, i.state);

        i.state = State.Released;
        uint256 amount = i.amount;
        escrowed -= amount;

        token.safeTransfer(i.payee, amount);
        emit Released(intentId, i.payee, amount, proof);
    }

    /// @notice Attest that the work did not happen and return the funds.
    function refund(bytes32 intentId, string calldata reason) external onlyVerifier nonReentrant {
        Intent storage i = intents[intentId];
        if (i.state != State.Open) revert NotOpen(intentId, i.state);

        i.state = State.Refunded;
        uint256 amount = i.amount;
        escrowed -= amount;

        token.safeTransfer(i.payer, amount);
        emit Refunded(intentId, i.payer, amount, reason);
    }

    /**
     * @notice Reclaim an intent no verifier ever ruled on.
     * @dev Without this the payer's funds depend on a verifier staying alive,
     *      which is exactly the trust assumption escrow is supposed to remove.
     */
    function reclaim(bytes32 intentId) external nonReentrant {
        Intent storage i = intents[intentId];
        if (i.state != State.Open) revert NotOpen(intentId, i.state);
        if (msg.sender != i.payer) revert NotPayer(msg.sender);
        if (block.timestamp < i.refundableAt) {
            revert TooEarlyToRefund(i.refundableAt, uint64(block.timestamp));
        }

        i.state = State.Refunded;
        uint256 amount = i.amount;
        escrowed -= amount;

        token.safeTransfer(i.payer, amount);
        emit Refunded(intentId, i.payer, amount, "reclaimed after refund window");
    }

    /// @notice Whether this intent has already been claimed, at any state.
    function isClaimed(bytes32 intentId) external view returns (bool) {
        return intents[intentId].state != State.None;
    }
}

/**
 * lib/stellar.ts
 * Stellar blockchain helpers for MarketPay.
 */

import {
  Horizon, Networks, Asset, Operation, TransactionBuilder, Transaction,
  Contract, nativeToScVal, Address, xdr,
} from "@stellar/stellar-sdk";
import { SorobanRpc } from "@stellar/stellar-sdk";

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
export const server = new Horizon.Server(HORIZON_URL);
export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

// XLM SAC (Stellar Asset Contract) address on testnet
export const XLM_SAC_ADDRESS =
  NETWORK === "mainnet"
    ? "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"
    : "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// USDC asset issued by Circle
export const USDC_ISSUER =
  NETWORK === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC = new Asset("USDC", USDC_ISSUER);

// ─── Account ─────────────────────────────────────────────────────────────────

export async function getXLMBalance(publicKey: string): Promise<string> {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find((b) => b.asset_type === "native");
    return xlm ? xlm.balance : "0";
  } catch {
    throw new Error("Account not found or not funded.");
  }
}

export async function getUSDCBalance(publicKey: string): Promise<string | null> {
  try {
    const account = await server.loadAccount(publicKey);
    const usdc = account.balances.find(
      (b): b is Horizon.HorizonApi.BalanceLineAsset =>
        b.asset_type !== "native" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === "USDC" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === USDC_ISSUER
    );
    return usdc ? usdc.balance : null;
  } catch {
    return null;
  }
}

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * Build an unsigned payment transaction for XLM or USDC.
 */
export async function buildPaymentTransaction({
  fromPublicKey, toPublicKey, amount, memo, asset = "XLM",
}: {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
  asset?: "XLM" | "USDC";
}) {
  const sourceAccount = await server.loadAccount(fromPublicKey);

  // Check recipient trustline for USDC
  if (asset === "USDC") {
    const recipient = await server.loadAccount(toPublicKey).catch(() => null);
    if (!recipient) throw new Error("Recipient account not found on Stellar network.");
    const hasTrustline = recipient.balances.some(
      (b): b is Horizon.HorizonApi.BalanceLineAsset =>
        b.asset_type !== "native" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === "USDC" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === USDC_ISSUER
    );
    if (!hasTrustline) {
      throw new Error("Recipient has no USDC trustline. They must add USDC to their wallet first.");
    }
  }

  const builder = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({
      destination: toPublicKey,
      asset: asset === "USDC" ? USDC : Asset.native(),
      amount,
    }))
    .setTimeout(60);

  if (memo) {
    const { Memo } = await import("@stellar/stellar-sdk");
    builder.addMemo(Memo.text(memo.slice(0, 28)));
  }

  return builder.build();
}

export async function submitTransaction(signedXDR: string) {
  const tx = new Transaction(signedXDR, NETWORK_PASSPHRASE);
  try {
    return await server.submitTransaction(tx);
  } catch (err: unknown) {
    const e = err as { response?: { data?: { extras?: { result_codes?: unknown } } } };
    if (e?.response?.data?.extras?.result_codes) {
      throw new Error(`Transaction failed: ${JSON.stringify(e.response.data.extras.result_codes)}`);
    }
    throw err;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

export function explorerUrl(hash: string): string {
  const net = NETWORK === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/tx/${hash}`;
}

// ─── Soroban / Escrow ─────────────────────────────────────────────────────────

/**
 * Build an unsigned Soroban transaction that calls create_escrow() on the
 * MarketPay contract.  The caller must sign it with Freighter and submit via
 * submitSorobanTransaction().
 *
 * @param clientPublicKey  Stellar address of the client (signer + payer)
 * @param jobId            Backend job UUID
 * @param freelancerAddress Stellar address of the freelancer (placeholder — use a dummy if not yet known)
 * @param budgetXLM        Budget in XLM (e.g. "100.0000000")
 */
export async function buildCreateEscrowTransaction({
  clientPublicKey,
  jobId,
  freelancerAddress,
  budgetXLM,
}: {
  clientPublicKey: string;
  jobId: string;
  freelancerAddress: string;
  budgetXLM: string;
}) {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
  if (!contractId) throw new Error("NEXT_PUBLIC_CONTRACT_ID is not set");

  // Convert XLM to stroops (1 XLM = 10_000_000 stroops)
  const amountStroops = BigInt(Math.round(parseFloat(budgetXLM) * 10_000_000));

  const contract = new Contract(contractId);
  const sourceAccount = await sorobanServer.getAccount(clientPublicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "1000000", // generous fee for Soroban ops
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "create_escrow",
        nativeToScVal(jobId, { type: "string" }),
        new Address(clientPublicKey).toScVal(),
        new Address(freelancerAddress).toScVal(),
        new Address(XLM_SAC_ADDRESS).toScVal(),
        nativeToScVal(amountStroops, { type: "i128" }),
      )
    )
    .setTimeout(60)
    .build();

  // Simulate to get the correct resource footprint
  const simResult = await sorobanServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Soroban simulation failed: ${simResult.error}`);
  }

  return SorobanRpc.assembleTransaction(tx, simResult).build();
}

/**
 * Submit a signed Soroban transaction and poll until it's confirmed.
 */
export async function submitSorobanTransaction(signedXDR: string): Promise<string> {
  const sendResult = await sorobanServer.sendTransaction(
    new Transaction(signedXDR, NETWORK_PASSPHRASE)
  );

  if (sendResult.status === "ERROR") {
    throw new Error(`Soroban submission failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const hash = sendResult.hash;

  // Poll for confirmation (up to 30s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await sorobanServer.getTransaction(hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return hash;
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Soroban transaction failed: ${hash}`);
    }
  }

  throw new Error(`Soroban transaction timed out: ${hash}`);
}

export function accountUrl(address: string): string {
  const net = NETWORK === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/account/${address}`;
}

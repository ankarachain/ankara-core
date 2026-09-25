import { ethers } from "ethers";
import type { AssetTemplate } from "@ankarachain/sdk";

/**
 * Per-template metadata fields for `deploy_token` — the same fields, units
 * and defaults the CLI's `ankara deploy` wizard prompts for, so a tool call
 * with no `metadata` produces the same token the CLI would with every prompt
 * left at its default.
 */
type FieldKind = "string" | "integer" | "usd" | "tonnes" | "days" | "hash" | "address";

export interface TemplateField {
  name: string;
  kind: FieldKind;
  description: string;
  default?: string | number;
  choices?: string[];
}

const HASH_NOTE = "32-byte 0x hex document hash (default: zero hash)";

export const TEMPLATE_FIELDS: Record<AssetTemplate, TemplateField[]> = {
  farmland: [
    { name: "location", kind: "string", description: "GPS location", default: "12.0022, 8.5919" },
    { name: "areaSqMeters", kind: "integer", description: "Area in square metres", default: 10000 },
    { name: "soilType", kind: "string", description: "Soil type", default: "loam" },
    { name: "irrigationType", kind: "string", description: "Irrigation type", default: "rain-fed" },
    { name: "cropHistory", kind: "string", description: "Crop history", default: "maize,sorghum,fallow" },
    { name: "stateRegion", kind: "string", description: "State / region", default: "Kano State" },
    { name: "valuationUSD", kind: "usd", description: "Valuation in whole USD", default: 50000 },
    { name: "titleDocumentHash", kind: "hash", description: HASH_NOTE },
  ],
  commodity: [
    { name: "commodityType", kind: "string", description: "Commodity type", default: "maize" },
    { name: "quantityKg", kind: "integer", description: "Quantity in kg", default: 5000 },
    { name: "gradeClassification", kind: "string", description: "Grade", default: "Grade A" },
    { name: "warehouseId", kind: "string", description: "Warehouse ID", default: "WH-001" },
    { name: "warehouseLocation", kind: "string", description: "Warehouse location", default: "Lagos, Nigeria" },
    { name: "harvestSeason", kind: "string", description: "Harvest season", default: "2025/2026" },
    { name: "valuationUSD", kind: "usd", description: "Valuation in whole USD", default: 10000 },
    { name: "expiryDays", kind: "days", description: "Receipt expiry, days from now", default: 180 },
    { name: "inspectionReportHash", kind: "hash", description: HASH_NOTE },
  ],
  "real-estate": [
    { name: "propertyId", kind: "string", description: "Property ID", default: "PROP-001" },
    { name: "propertyType", kind: "string", description: "Property type", default: "Residential", choices: ["Residential", "Commercial", "Industrial", "Land"] },
    { name: "locationAddress", kind: "string", description: "Location address", default: "12 Victoria Island, Lagos" },
    { name: "totalAreaSqMeters", kind: "integer", description: "Total area in square metres", default: 200 },
    { name: "occupancyStatus", kind: "string", description: "Occupancy status", default: "Vacant", choices: ["Vacant", "Owner-occupied", "Tenanted"] },
    { name: "rentalYieldBps", kind: "integer", description: "Rental yield in bps (600 = 6%)", default: 600 },
    { name: "valuationUSD", kind: "usd", description: "Valuation in whole USD", default: 250000 },
    { name: "developerAddress", kind: "address", description: "Developer address (default: the signer)" },
    { name: "titleDocumentHash", kind: "hash", description: HASH_NOTE },
  ],
  invoice: [
    { name: "invoiceNumber", kind: "string", description: "Invoice number", default: "INV-2025-001" },
    { name: "debtorReference", kind: "string", description: "Debtor reference", default: "DEBTOR-001" },
    { name: "faceValueUSD", kind: "usd", description: "Face value in whole USD", default: 100000 },
    { name: "discountRateBps", kind: "integer", description: "Discount rate in bps (200 = 2%)", default: 200 },
    { name: "dueDays", kind: "days", description: "Days until due", default: 90 },
    { name: "currency", kind: "string", description: "Currency (ISO 4217)", default: "USD" },
    { name: "invoiceDocumentHash", kind: "hash", description: HASH_NOTE },
  ],
  "carbon-credit": [
    { name: "creditType", kind: "string", description: "Credit type", default: "VCS", choices: ["REDD+", "VCS", "Gold Standard", "GS4GG", "CDM"] },
    { name: "verificationBodyRef", kind: "string", description: "Verification body reference", default: "VERRA-001" },
    { name: "vintageYear", kind: "integer", description: "Vintage year", default: 2025 },
    { name: "quantityCO2e", kind: "tonnes", description: "Quantity in tonnes CO2e", default: 1000 },
    { name: "projectLocation", kind: "string", description: "Project location", default: "Congo Basin, DRC" },
    { name: "projectType", kind: "string", description: "Project type", default: "Forestry", choices: ["Forestry", "Agriculture", "Energy", "Waste"] },
    { name: "verificationDocHash", kind: "hash", description: HASH_NOTE },
  ],
  "mining-rights": [
    { name: "licenseNumber", kind: "string", description: "License number", default: "LIC-001" },
    { name: "mineralType", kind: "string", description: "Mineral type", default: "Gold", choices: ["Gold", "Coltan", "Copper", "Diamond", "Coal", "Lithium"] },
    { name: "concessionArea", kind: "string", description: "Concession area description", default: "North Block A" },
    { name: "areaHectares", kind: "integer", description: "Area in hectares", default: 500 },
    { name: "licenseExpiryDays", kind: "days", description: "License expiry, days from now", default: 365 },
    { name: "issuingAuthority", kind: "string", description: "Issuing authority", default: "Ministry of Mines" },
    { name: "royaltyRateBps", kind: "integer", description: "Royalty rate in bps (300 = 3%)", default: 300 },
    { name: "licenseDocumentHash", kind: "hash", description: HASH_NOTE },
  ],
};

export const TEMPLATES = Object.keys(TEMPLATE_FIELDS) as AssetTemplate[];

const DAY = 24n * 60n * 60n;

/**
 * Validates `input` against the template's field list (rejecting unknown
 * fields and invalid choices) and returns the resolved values with defaults
 * applied.
 */
function resolve(template: AssetTemplate, input: Record<string, unknown>): Record<string, unknown> {
  const fields = TEMPLATE_FIELDS[template];
  if (!fields) throw new Error(`Unsupported template: ${template}. Expected one of: ${TEMPLATES.join(", ")}`);
  const known = new Set(fields.map((f) => f.name));
  const unknown = Object.keys(input).filter((k) => !known.has(k));
  if (unknown.length) {
    throw new Error(`Unknown ${template} metadata field(s): ${unknown.join(", ")}. Allowed: ${[...known].join(", ")}`);
  }
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = input[f.name] ?? f.default;
    if (f.choices && v !== undefined && !f.choices.includes(String(v))) {
      throw new Error(`${template}.${f.name} must be one of: ${f.choices.join(", ")}`);
    }
    if ((f.kind === "integer" || f.kind === "usd" || f.kind === "tonnes" || f.kind === "days") && v !== undefined
        && !/^\d+(\.\d+)?$/.test(String(v))) {
      throw new Error(`${template}.${f.name} must be a non-negative number, got "${v}"`);
    }
    if (f.kind === "hash" && v !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(String(v))) {
      throw new Error(`${template}.${f.name} must be a 0x-prefixed 32-byte hex string`);
    }
    out[f.name] = v;
  }
  return out;
}

const int = (v: unknown) => BigInt(String(v).split(".")[0]);
const usd = (v: unknown) => ethers.parseEther(String(v));
const hash = (v: unknown) => (v as string | undefined) ?? ethers.ZeroHash;

/** Builds the SDK `*Metadata` object for `TokenFactory.deploy*`. */
export function buildTemplateMetadata(
  template: AssetTemplate,
  input: Record<string, unknown>,
  ctx: { now?: bigint; signer: string }
): Record<string, unknown> {
  const m = resolve(template, input);
  const now = ctx.now ?? BigInt(Math.floor(Date.now() / 1000));
  switch (template) {
    case "farmland":
      return {
        location: m.location, areaSqMeters: int(m.areaSqMeters), soilType: m.soilType,
        irrigationType: m.irrigationType, cropHistory: m.cropHistory, titleDocumentHash: hash(m.titleDocumentHash),
        valuationUSD: usd(m.valuationUSD), stateRegion: m.stateRegion, lastUpdated: now,
      };
    case "commodity":
      return {
        commodityType: m.commodityType, quantityKg: int(m.quantityKg), gradeClassification: m.gradeClassification,
        warehouseId: m.warehouseId, warehouseLocation: m.warehouseLocation, depositDate: now,
        expiryDate: now + int(m.expiryDays) * DAY, inspectionReportHash: hash(m.inspectionReportHash),
        valuationUSD: usd(m.valuationUSD), harvestSeason: m.harvestSeason, lastUpdated: now,
      };
    case "real-estate":
      return {
        propertyId: m.propertyId, propertyType: m.propertyType, locationAddress: m.locationAddress,
        totalAreaSqMeters: int(m.totalAreaSqMeters), titleDocumentHash: hash(m.titleDocumentHash),
        valuationUSD: usd(m.valuationUSD), rentalYieldBps: int(m.rentalYieldBps),
        occupancyStatus: m.occupancyStatus, developerAddress: (m.developerAddress as string | undefined) ?? ctx.signer,
        lastUpdated: now,
      };
    case "invoice":
      return {
        invoiceNumber: m.invoiceNumber, debtorReference: m.debtorReference, faceValueUSD: usd(m.faceValueUSD),
        discountRateBps: int(m.discountRateBps), issuanceDate: now, dueDate: now + int(m.dueDays) * DAY,
        invoiceDocumentHash: hash(m.invoiceDocumentHash), currency: m.currency, lastUpdated: now,
      };
    case "carbon-credit":
      return {
        creditType: m.creditType, verificationBodyRef: m.verificationBodyRef, vintageYear: int(m.vintageYear),
        quantityCO2e: usd(m.quantityCO2e), projectLocation: m.projectLocation, projectType: m.projectType,
        verificationDocHash: hash(m.verificationDocHash), lastUpdated: now,
      };
    case "mining-rights":
      return {
        licenseNumber: m.licenseNumber, mineralType: m.mineralType, concessionArea: m.concessionArea,
        areaHectares: int(m.areaHectares), licenseExpiry: now + int(m.licenseExpiryDays) * DAY,
        issuingAuthority: m.issuingAuthority, licenseDocumentHash: hash(m.licenseDocumentHash),
        royaltyRateBps: int(m.royaltyRateBps), lastUpdated: now,
      };
  }
}

/** Which `TokenFactory` method deploys each template. */
export const DEPLOY_METHOD: Record<AssetTemplate, string> = {
  farmland: "deployFarmland",
  commodity: "deployCommodity",
  "real-estate": "deployRealEstate",
  invoice: "deployInvoice",
  "carbon-credit": "deployCarbonCredit",
  "mining-rights": "deployMiningRights",
};

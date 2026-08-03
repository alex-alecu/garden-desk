import { z } from "zod";
import { GenerationContextLimitReasonSchema } from "./inference.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ModelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u);

export const ModelRedistributionStatusSchema = z.enum([
  "development",
  "candidate_to_ship",
  "ships",
]);

const ShipApprovalSchema = z
  .object({
    approvedBy: z.literal("repository_owner"),
    approvedAt: z.iso.datetime(),
    noticePath: z.string().min(1),
    redistributionBasis: z.string().min(1),
  })
  .strict();

const RedistributionSchema = z
  .object({
    status: ModelRedistributionStatusSchema,
    reviewOwner: z.literal("repository_owner"),
    shipApproval: ShipApprovalSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const approvalRequired = value.status === "ships" && value.shipApproval === undefined;
    if (!approvalRequired) return;
    context.addIssue({
      code: "custom",
      message: "A ships transition requires explicit repository-owner approval.",
      path: ["shipApproval"],
    });
  });

const ModelSourceSchema = z
  .object({
    host: z.literal("huggingface.co"),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
    revision: z.string().regex(/^[a-f0-9]{40}$/u),
    file: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  })
  .strict();

export const ModelAssetSchema = z
  .object({
    id: ModelIdSchema,
    family: z.string().min(1),
    role: z.enum(["generation", "embedding", "multimodal_projector"]),
    companionFor: ModelIdSchema.optional(),
    source: ModelSourceSchema,
    byteLength: z.number().int().positive(),
    sha256: Sha256Schema,
    license: z.string().min(1),
    redistribution: RedistributionSchema,
  })
  .strict();

export const ModelManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    reviewOwner: z.literal("repository_owner"),
    models: z.array(ModelAssetSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const identifiers = new Set<string>();
    for (const [index, model] of value.models.entries()) {
      if (identifiers.has(model.id)) {
        context.addIssue({
          code: "custom",
          message: "Model identifiers must be unique.",
          path: ["models", index, "id"],
        });
      }
      identifiers.add(model.id);
    }
    for (const [index, model] of value.models.entries()) {
      if (model.companionFor !== undefined && !identifiers.has(model.companionFor)) {
        context.addIssue({
          code: "custom",
          message: "Model companion target is missing.",
          path: ["models", index, "companionFor"],
        });
      }
    }
  });

export const InstalledModelIdentitySchema = z
  .object({
    modelId: ModelIdSchema,
    sha256: Sha256Schema,
    byteLength: z.number().int().positive(),
    runtimeBuild: z.string().min(1),
    storeKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    installedAt: z.iso.datetime(),
  })
  .strict();

export const InstalledModelStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    models: z.array(InstalledModelIdentitySchema),
  })
  .strict();

export const ModelRuntimeStatusSchema = z.object({
  modelId: ModelIdSchema,
  name: z.string().min(1),
  state: z.enum(["unsupported", "unloaded", "loading", "ready", "busy"]),
  thinkingSupported: z.boolean(),
  message: z.string().min(1).optional(),
  memoryBudgetBytes: z.number().int().positive().optional(),
  cpuRamBytes: z.number().int().nonnegative().optional(),
  gpuVramBytes: z.number().int().nonnegative().optional(),
  contextSizeTokens: z.number().int().positive().optional(),
  contextLimitTokens: z.number().int().positive().optional(),
  contextLimitReason: GenerationContextLimitReasonSchema.optional(),
});

export type ModelRedistributionStatus = z.infer<typeof ModelRedistributionStatusSchema>;
export type ModelAsset = z.infer<typeof ModelAssetSchema>;
export type ModelManifest = z.infer<typeof ModelManifestSchema>;
export type InstalledModelIdentity = z.infer<typeof InstalledModelIdentitySchema>;
export type InstalledModelStore = z.infer<typeof InstalledModelStoreSchema>;
export type ModelRuntimeStatus = z.infer<typeof ModelRuntimeStatusSchema>;

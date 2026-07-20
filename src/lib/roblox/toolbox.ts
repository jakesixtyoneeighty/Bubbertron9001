/**
 * Roblox Creator Store API client.
 *
 * Search and detail responses are treated as untrusted external data. Only
 * explicitly free, purchasable assets of the requested Creator Store type are
 * returned to the agent.
 */

import { z } from "zod";
import { appFetch } from "@/lib/http";

export type AssetCategory =
  | "Model"
  | "Decal"
  | "Audio"
  | "Plugin"
  | "MeshPart";

export interface ToolboxAsset {
  id: number;
  name: string;
  description: string;
  category: AssetCategory;
  assetTypeId: number;
  creatorName: string;
  creatorId: number;
  thumbnailUrl?: string;
  created: string;
  updated: string;
  voteCount?: number;
  upVotePercent?: number;
  hasScripts: boolean;
  scriptCount: number;
  shouldSandbox: boolean;
  purchasable: true;
  isFree: true;
}

export interface ToolboxSearchResult {
  assets: ToolboxAsset[];
  nextPageCursor?: string;
}

const CREATOR_STORE_SEARCH_API =
  "https://apis.roblox.com/toolbox-service/v2/assets:search";
const CREATOR_STORE_ASSET_API =
  "https://apis.roblox.com/toolbox-service/v2/assets";
const THUMBNAILS_API = "https://thumbnails.roblox.com/v1/assets";
const MAX_SEARCH_LIMIT = 50;

const CATEGORY_TO_TYPE: Record<AssetCategory, number> = {
  Model: 10,
  Decal: 13,
  Audio: 3,
  Plugin: 38,
  MeshPart: 40,
};

const TYPE_TO_CATEGORY = Object.fromEntries(
  Object.entries(CATEGORY_TO_TYPE).map(([category, assetTypeId]) => [
    assetTypeId,
    category,
  ])
) as Record<number, AssetCategory>;

const priceQuantitySchema = z.object({
  significand: z.union([z.number(), z.string()]),
  exponent: z.number().int(),
});

const creatorStoreAssetSchema = z.object({
  voting: z
    .object({
      voteCount: z.number().int().nonnegative().optional(),
      upVotePercent: z.number().min(0).max(100).optional(),
    })
    .optional(),
  creator: z.object({
    creator: z.string().optional(),
    userId: z.number().int().nonnegative().optional(),
    groupId: z.number().int().nonnegative().optional(),
    name: z.string().min(1),
  }),
  creatorStoreProduct: z.object({
    purchasable: z.boolean(),
    purchasePrice: z.object({
      currencyCode: z.string().min(1),
      quantity: priceQuantitySchema,
    }),
  }),
  asset: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().nullish(),
    assetTypeId: z.number().int().positive(),
    createTime: z.string().optional(),
    updateTime: z.string().optional(),
    hasScripts: z.boolean().optional(),
    scriptCount: z.number().int().nonnegative().optional(),
    instanceCounts: z
      .object({
        script: z.number().int().nonnegative().optional(),
      })
      .optional(),
    capabilities: z
      .object({
        shouldSandbox: z.boolean().optional(),
      })
      .optional(),
  }),
});

const creatorStoreSearchSchema = z.object({
  creatorStoreAssets: z.array(z.unknown()),
  nextPageToken: z.string().optional(),
});

const thumbnailResponseSchema = z.object({
  data: z.array(
    z.object({
      targetId: z.number().int().positive(),
      imageUrl: z.string().min(1),
      state: z.string(),
    })
  ),
});

function requestedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(limit)));
}

function isExplicitlyFree(
  quantity: z.infer<typeof priceQuantitySchema>
): boolean {
  const significand =
    typeof quantity.significand === "number"
      ? quantity.significand
      : Number(quantity.significand);
  return Number.isFinite(significand) && significand === 0;
}

function creatorId(
  creator: z.infer<typeof creatorStoreAssetSchema>["creator"]
): number {
  if (creator.userId !== undefined) return creator.userId;
  if (creator.groupId !== undefined) return creator.groupId;

  const creatorPath = creator.creator?.split("/") ?? [];
  const pathId = Number(creatorPath[creatorPath.length - 1]);
  return Number.isSafeInteger(pathId) && pathId >= 0 ? pathId : 0;
}

function parseCreatorStoreAsset(
  value: unknown,
  expectedAssetTypeId?: number
): ToolboxAsset | null {
  const parsed = creatorStoreAssetSchema.safeParse(value);
  if (!parsed.success) return null;

  const { asset, creator, creatorStoreProduct, voting } = parsed.data;
  if (
    expectedAssetTypeId !== undefined &&
    asset.assetTypeId !== expectedAssetTypeId
  ) {
    return null;
  }

  const category = TYPE_TO_CATEGORY[asset.assetTypeId];
  if (
    !category ||
    creatorStoreProduct.purchasable !== true ||
    !isExplicitlyFree(creatorStoreProduct.purchasePrice.quantity)
  ) {
    return null;
  }

  const scriptCount =
    asset.scriptCount ?? asset.instanceCounts?.script ?? 0;
  const hasScripts = asset.hasScripts === true || scriptCount > 0;

  return {
    id: asset.id,
    name: asset.name,
    description: asset.description ?? "",
    category,
    assetTypeId: asset.assetTypeId,
    creatorName: creator.name,
    creatorId: creatorId(creator),
    created: asset.createTime ?? "",
    updated: asset.updateTime ?? "",
    voteCount: voting?.voteCount,
    upVotePercent: voting?.upVotePercent,
    hasScripts,
    scriptCount,
    shouldSandbox: asset.capabilities?.shouldSandbox === true,
    purchasable: true,
    isFree: true,
  };
}

async function fetchThumbnails(
  assetIds: number[]
): Promise<Record<number, string>> {
  if (assetIds.length === 0) return {};

  const params = new URLSearchParams({
    assetIds: assetIds.join(","),
    size: "150x150",
    format: "Png",
    isCircular: "false",
  });

  const response = await appFetch(`${THUMBNAILS_API}?${params}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return {};

  const parsed = thumbnailResponseSchema.safeParse(await response.json());
  if (!parsed.success) return {};

  return Object.fromEntries(
    parsed.data.data
      .filter(
        (thumbnail) =>
          thumbnail.state === "Completed" && thumbnail.imageUrl.length > 0
      )
      .map((thumbnail) => [thumbnail.targetId, thumbnail.imageUrl])
  );
}

async function attachThumbnails(
  assets: ToolboxAsset[]
): Promise<ToolboxAsset[]> {
  try {
    const thumbnails = await fetchThumbnails(assets.map((asset) => asset.id));
    return assets.map((asset) => ({
      ...asset,
      thumbnailUrl: thumbnails[asset.id],
    }));
  } catch {
    // Thumbnails are optional presentation data; valid search results remain
    // useful if Roblox's thumbnail service is temporarily unavailable.
    return assets;
  }
}

export async function searchToolbox(
  query: string,
  category: AssetCategory = "Model",
  limit = 10
): Promise<ToolboxSearchResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error("Creator Store search query cannot be empty");
  }

  const maxPageSize = requestedLimit(limit);
  const expectedAssetTypeId = CATEGORY_TO_TYPE[category];
  const params = new URLSearchParams({
    searchCategoryType: category,
    query: normalizedQuery,
    maxPageSize: maxPageSize.toString(),
  });

  const response = await appFetch(`${CREATOR_STORE_SEARCH_API}?${params}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Creator Store search failed: ${response.status}`);
  }

  const parsed = creatorStoreSearchSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Creator Store returned an invalid search response");
  }

  const validatedAssets = parsed.data.creatorStoreAssets
    .map((asset) => parseCreatorStoreAsset(asset, expectedAssetTypeId))
    .filter((asset): asset is ToolboxAsset => asset !== null)
    .slice(0, maxPageSize);
  const assets = await attachThumbnails(validatedAssets);

  return {
    assets,
    nextPageCursor: parsed.data.nextPageToken,
  };
}

export async function getAssetDetails(
  assetId: number,
  expectedCategory?: AssetCategory
): Promise<ToolboxAsset | null> {
  if (!Number.isSafeInteger(assetId) || assetId <= 0) return null;

  const response = await appFetch(`${CREATOR_STORE_ASSET_API}/${assetId}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;

  const asset = parseCreatorStoreAsset(
    await response.json(),
    expectedCategory ? CATEGORY_TO_TYPE[expectedCategory] : undefined
  );
  if (!asset) return null;

  const [withThumbnail] = await attachThumbnails([asset]);
  return withThumbnail ?? asset;
}

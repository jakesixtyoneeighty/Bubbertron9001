import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/setup";
import { getAssetDetails, searchToolbox } from "../toolbox";

const SEARCH_API =
  "https://apis.roblox.com/toolbox-service/v2/assets:search";
const ASSET_API = "https://apis.roblox.com/toolbox-service/v2/assets";
const THUMBNAILS_API = "https://thumbnails.roblox.com/v1/assets";

interface CreatorStoreFixtureOptions {
  id?: number;
  assetTypeId?: number;
  purchasable?: boolean;
  priceSignificand?: number | string;
  hasScripts?: boolean;
  scriptCount?: number;
  shouldSandbox?: boolean;
  creatorKind?: "user" | "group";
}

function creatorStoreFixture({
  id = 101,
  assetTypeId = 10,
  purchasable = true,
  priceSignificand = 0,
  hasScripts = false,
  scriptCount = 0,
  shouldSandbox = false,
  creatorKind = "user",
}: CreatorStoreFixtureOptions = {}) {
  const creator =
    creatorKind === "group"
      ? {
          creator: "group/456",
          groupId: 456,
          name: "Builder Group",
        }
      : {
          creator: "user/123",
          userId: 123,
          name: "Builder",
        };

  return {
    voting: {
      voteCount: 250,
      upVotePercent: 92,
    },
    creator,
    creatorStoreProduct: {
      purchasable,
      purchasePrice: {
        currencyCode: "USD",
        quantity: {
          significand: priceSignificand,
          exponent: 0,
        },
      },
    },
    asset: {
      id,
      name: `Asset ${id}`,
      description: "A useful Creator Store asset",
      assetTypeId,
      createTime: "2025-01-02T03:04:05Z",
      updateTime: "2025-06-07T08:09:10Z",
      hasScripts,
      scriptCount,
      instanceCounts: { script: scriptCount },
      capabilities: { shouldSandbox },
    },
  };
}

function mockThumbnails() {
  server.use(
    http.get(THUMBNAILS_API, ({ request }) => {
      const ids = new URL(request.url).searchParams
        .get("assetIds")
        ?.split(",")
        .map(Number) ?? [];
      return HttpResponse.json({
        data: ids.map((id) => ({
          targetId: id,
          state: "Completed",
          imageUrl: `https://tr.rbxcdn.com/${id}.png`,
        })),
      });
    })
  );
}

describe("Creator Store v2 client", () => {
  it("uses the v2 search contract and preserves safety metadata and thumbnails", async () => {
    server.use(
      http.get(SEARCH_API, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("searchCategoryType")).toBe("Model");
        expect(url.searchParams.get("query")).toBe("sports car");
        expect(url.searchParams.get("maxPageSize")).toBe("7");

        return HttpResponse.json({
          nextPageToken: "next-token",
          creatorStoreAssets: [
            creatorStoreFixture({
              id: 501,
              hasScripts: true,
              scriptCount: 3,
              shouldSandbox: true,
            }),
          ],
        });
      })
    );
    mockThumbnails();

    const result = await searchToolbox("  sports car  ", "Model", 7);

    expect(result.nextPageCursor).toBe("next-token");
    expect(result.assets).toEqual([
      expect.objectContaining({
        id: 501,
        category: "Model",
        assetTypeId: 10,
        creatorName: "Builder",
        creatorId: 123,
        hasScripts: true,
        scriptCount: 3,
        shouldSandbox: true,
        purchasable: true,
        isFree: true,
        voteCount: 250,
        upVotePercent: 92,
        thumbnailUrl: "https://tr.rbxcdn.com/501.png",
      }),
    ]);
  });

  it("fails closed on wrong-type, paid, unavailable, and malformed results", async () => {
    server.use(
      http.get(SEARCH_API, () =>
        HttpResponse.json({
          creatorStoreAssets: [
            creatorStoreFixture({
              id: 1,
              priceSignificand: "0",
              creatorKind: "group",
            }),
            creatorStoreFixture({ id: 2, assetTypeId: 13 }),
            creatorStoreFixture({ id: 3, priceSignificand: 5 }),
            creatorStoreFixture({ id: 4, purchasable: false }),
            { asset: { id: 5, assetTypeId: 10 } },
          ],
        })
      )
    );
    mockThumbnails();

    const result = await searchToolbox("vehicle", "Model", 50);

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      id: 1,
      creatorName: "Builder Group",
      creatorId: 456,
      category: "Model",
      isFree: true,
    });
  });

  it("rejects an invalid top-level search response", async () => {
    server.use(
      http.get(SEARCH_API, () =>
        HttpResponse.json({ data: [creatorStoreFixture()] })
      )
    );

    await expect(searchToolbox("car")).rejects.toThrow(
      "Creator Store returned an invalid search response"
    );
  });

  it("reports Creator Store HTTP failures", async () => {
    server.use(
      http.get(
        SEARCH_API,
        () => new HttpResponse(null, { status: 503 })
      )
    );

    await expect(searchToolbox("car")).rejects.toThrow(
      "Creator Store search failed: 503"
    );
  });

  it("revalidates a direct asset as a free model before insertion", async () => {
    server.use(
      http.get(`${ASSET_API}/9001`, () =>
        HttpResponse.json(
          creatorStoreFixture({
            id: 9001,
            hasScripts: true,
            scriptCount: 2,
            shouldSandbox: true,
          })
        )
      )
    );
    mockThumbnails();

    const asset = await getAssetDetails(9001, "Model");

    expect(asset).toMatchObject({
      id: 9001,
      category: "Model",
      hasScripts: true,
      scriptCount: 2,
      shouldSandbox: true,
      thumbnailUrl: "https://tr.rbxcdn.com/9001.png",
    });
  });

  it("rejects paid, unavailable, and wrong-type direct assets", async () => {
    server.use(
      http.get(`${ASSET_API}/10`, () =>
        HttpResponse.json(
          creatorStoreFixture({ id: 10, priceSignificand: 1 })
        )
      ),
      http.get(`${ASSET_API}/11`, () =>
        HttpResponse.json(
          creatorStoreFixture({ id: 11, purchasable: false })
        )
      ),
      http.get(`${ASSET_API}/12`, () =>
        HttpResponse.json(
          creatorStoreFixture({ id: 12, assetTypeId: 13 })
        )
      )
    );

    await expect(getAssetDetails(10, "Model")).resolves.toBeNull();
    await expect(getAssetDetails(11, "Model")).resolves.toBeNull();
    await expect(getAssetDetails(12, "Model")).resolves.toBeNull();
  });

  it("keeps validated assets when thumbnails are unavailable", async () => {
    server.use(
      http.get(SEARCH_API, () =>
        HttpResponse.json({
          creatorStoreAssets: [creatorStoreFixture({ id: 77 })],
        })
      ),
      http.get(
        THUMBNAILS_API,
        () => new HttpResponse(null, { status: 500 })
      )
    );

    const result = await searchToolbox("simple model");

    expect(result.assets).toEqual([
      expect.objectContaining({ id: 77, thumbnailUrl: undefined }),
    ]);
  });
});

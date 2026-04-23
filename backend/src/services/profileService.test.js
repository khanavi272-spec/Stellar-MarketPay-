jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const pool = require("../db/pool");
const {
  getProfile,
  upsertProfile,
  MAX_PORTFOLIO_ITEMS,
} = require("./profileService");

describe("profileService", () => {
  const publicKey = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("upsertProfile", () => {
    it("accepts valid portfolioItems", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            public_key: publicKey,
            display_name: "Jane Doe",
            bio: "Freelancer bio",
            skills: ["React", "Stellar"],
            portfolio_items: [
              { title: "Repo", url: "https://github.com/example/repo", type: "github" },
              { title: "Launch", url: "https://example.com", type: "live" },
              { title: "Escrow release", url: "abc123tx", type: "stellar_tx" },
            ],
            role: "freelancer",
            completed_jobs: 0,
            total_earned_xlm: "0.0000000",
            rating: null,
            created_at: "2026-04-23T00:00:00.000Z",
            updated_at: "2026-04-23T00:00:00.000Z",
          },
        ],
      });

      const profile = await upsertProfile({
        publicKey,
        role: "freelancer",
        portfolioItems: [
          { title: "Repo", url: "https://github.com/example/repo", type: "github" },
          { title: "Launch", url: "https://example.com", type: "live" },
          { title: "Escrow release", url: "abc123tx", type: "stellar_tx" },
        ],
      });

      expect(profile.portfolioItems).toHaveLength(3);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(JSON.parse(pool.query.mock.calls[0][1][4])).toEqual(
        [
          { title: "Repo", url: "https://github.com/example/repo", type: "github" },
          { title: "Launch", url: "https://example.com", type: "live" },
          { title: "Escrow release", url: "abc123tx", type: "stellar_tx" },
        ]
      );
    });

    it("rejects invalid portfolio item type", async () => {
      await expect(
        upsertProfile({
          publicKey,
          role: "freelancer",
          portfolioItems: [
            { title: "Repo", url: "https://github.com/example/repo", type: "gitlab" },
          ],
        })
      ).rejects.toThrow("Portfolio item type must be one of: github, live, stellar_tx");

      expect(pool.query).not.toHaveBeenCalled();
    });

    it("rejects more than ten portfolio items", async () => {
      await expect(
        upsertProfile({
          publicKey,
          role: "freelancer",
          portfolioItems: Array.from({ length: MAX_PORTFOLIO_ITEMS + 1 }, (_, index) => ({
            title: `Work ${index + 1}`,
            url: `https://example.com/${index + 1}`,
            type: "live",
          })),
        })
      ).rejects.toThrow(`portfolioItems cannot exceed ${MAX_PORTFOLIO_ITEMS} items`);

      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe("getProfile", () => {
    it("returns portfolioItems from the profile row", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            public_key: publicKey,
            display_name: "Jane Doe",
            bio: "Freelancer bio",
            skills: ["React"],
            portfolio_items: [
              { title: "Repo", url: "https://github.com/example/repo", type: "github" },
            ],
            role: "freelancer",
            completed_jobs: 3,
            total_earned_xlm: "150.0000000",
            avg_rating: "4.80",
            rating_count: 2,
            created_at: "2026-04-23T00:00:00.000Z",
            updated_at: "2026-04-23T00:00:00.000Z",
          },
        ],
      });

      const profile = await getProfile(publicKey);

      expect(profile.portfolioItems).toEqual([
        { title: "Repo", url: "https://github.com/example/repo", type: "github" },
      ]);
      expect(profile.rating).toBe(4.8);
      expect(profile.ratingCount).toBe(2);
    });
  });
});

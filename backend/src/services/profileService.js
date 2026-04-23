/**
 * src/services/profileService.js
 * All data persisted in the `profiles` PostgreSQL table.
 */
"use strict";

const pool = require("../db/pool");

const VALID_PROFILE_ROLES = ["client", "freelancer", "both"];
const VALID_PORTFOLIO_TYPES = ["github", "live", "stellar_tx"];
const MAX_PORTFOLIO_ITEMS = 10;

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function createValidationError(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

function validateProfileRole(role) {
  if (role == null || role === "") return "both";
  if (!VALID_PROFILE_ROLES.includes(role)) {
    throw createValidationError("Role must be one of: client, freelancer, both");
  }
  return role;
}

function validatePortfolioUrl(url, type) {
  if (typeof url !== "string" || !url.trim()) {
    throw createValidationError("Each portfolio item must include a url");
  }

  const trimmedUrl = url.trim();
  if (type === "stellar_tx") return trimmedUrl;

  try {
    const parsed = new URL(trimmedUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Invalid protocol");
    }
  } catch (_) {
    throw createValidationError("Portfolio item url must be a valid http or https URL");
  }

  return trimmedUrl;
}

function validatePortfolioItems(portfolioItems) {
  if (portfolioItems == null) return [];
  if (!Array.isArray(portfolioItems)) {
    throw createValidationError("portfolioItems must be an array");
  }
  if (portfolioItems.length > MAX_PORTFOLIO_ITEMS) {
    throw createValidationError(`portfolioItems cannot exceed ${MAX_PORTFOLIO_ITEMS} items`);
  }

  return portfolioItems.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createValidationError("Each portfolio item must be an object");
    }

    const title = typeof item.title === "string" ? item.title.trim() : "";
    const type = typeof item.type === "string" ? item.type.trim() : "";

    if (!title) {
      throw createValidationError("Each portfolio item must include a title");
    }
    if (!VALID_PORTFOLIO_TYPES.includes(type)) {
      throw createValidationError("Portfolio item type must be one of: github, live, stellar_tx");
    }

    return {
      title,
      type,
      url: validatePortfolioUrl(item.url, type),
    };
  });
}

function rowToProfile(row) {
  return {
    publicKey: row.public_key,
    displayName: row.display_name,
    bio: row.bio,
    skills: row.skills,
    portfolioItems: Array.isArray(row.portfolio_items) ? row.portfolio_items : [],
    role: row.role,
    completedJobs: row.completed_jobs,
    totalEarnedXLM: row.total_earned_xlm,
    rating: row.rating !== null ? parseFloat(row.rating) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getProfile(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `SELECT p.*,
       ROUND(AVG(r.stars)::numeric, 2) AS avg_rating,
       COUNT(r.id)::int                AS rating_count
     FROM profiles p
     LEFT JOIN ratings r ON r.rated_address = p.public_key
     WHERE p.public_key = $1
     GROUP BY p.public_key`,
    [publicKey]
  );

  if (!rows.length) {
    const e = new Error("Profile not found");
    e.status = 404;
    throw e;
  }

  const profile = rowToProfile(rows[0]);
  profile.rating = rows[0].avg_rating !== null ? parseFloat(rows[0].avg_rating) : null;
  profile.ratingCount = rows[0].rating_count;
  return profile;
}

async function upsertProfile({ publicKey, displayName, bio, skills, portfolioItems, role }) {
  validatePublicKey(publicKey);

  const safeSkills = Array.isArray(skills) ? skills.slice(0, 15) : null;
  const safePortfolioItems = validatePortfolioItems(portfolioItems);
  const safeRole = validateProfileRole(role);

  const { rows } = await pool.query(
    `
    INSERT INTO profiles (public_key, display_name, bio, skills, portfolio_items, role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
    ON CONFLICT (public_key) DO UPDATE
      SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), profiles.display_name),
          bio = COALESCE(NULLIF(EXCLUDED.bio, ''), profiles.bio),
          skills = COALESCE(EXCLUDED.skills, profiles.skills),
          portfolio_items = COALESCE(EXCLUDED.portfolio_items, profiles.portfolio_items),
          role = COALESCE(NULLIF(EXCLUDED.role, ''), profiles.role),
          updated_at = NOW()
    RETURNING *
    `,
    [
      publicKey,
      displayName?.trim() || null,
      bio?.trim() || null,
      safeSkills,
      JSON.stringify(safePortfolioItems),
      safeRole,
    ]
  );

  return rowToProfile(rows[0]);
}

module.exports = {
  getProfile,
  upsertProfile,
  VALID_PORTFOLIO_TYPES,
  MAX_PORTFOLIO_ITEMS,
};

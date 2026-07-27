import type { TagMeta } from "@drafthelper/shared";
import "./TagBadges.css";

/** Small colored chips for every tag a player carries (Sleeper, My guy, ...). */
export function TagBadges({ tags }: { tags: TagMeta[] | undefined }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="tag-badges">
      {tags.map((tag) => (
        <span key={tag.id} className={`tag-badge tag-color-${tag.color}`} title={tag.label}>
          {tag.label}
        </span>
      ))}
    </span>
  );
}

/** Compact dot variant for tight spaces (canvas chips) — up to 2 dots, title-only label. */
export function TagDots({ tags }: { tags: TagMeta[] | undefined }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="tag-dots">
      {tags.slice(0, 2).map((tag) => (
        <span key={tag.id} className={`tag-dot tag-color-${tag.color}`} title={tag.label} />
      ))}
    </span>
  );
}

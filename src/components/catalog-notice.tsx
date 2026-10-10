export function CatalogNotice({
  compact = false,
}: {
  compact?: boolean;
  mode?: string;
}) {
  return (
    <p className={`catalog-notice ${compact ? "compact" : ""}`}>
      Checkout is not yet available. Browse product details and contact support
      for guidance.
    </p>
  );
}

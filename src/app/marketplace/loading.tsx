export default function Loading() {
  return (
    <section
      className="container section"
      aria-label="Loading page"
      role="status"
    >
      <span className="sr-only">Loading, please wait.</span>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-copy" />
      <div className="loading-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton skeleton-card" />
        ))}
      </div>
    </section>
  );
}

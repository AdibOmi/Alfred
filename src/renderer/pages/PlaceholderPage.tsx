interface PlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function PlaceholderPage({ eyebrow, title, description }: PlaceholderPageProps) {
  return (
    <>
      <div className="page-header">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <section className="panel">
        <div className="placeholder-page">
          <span className="placeholder-icon">◆</span>
          <h3>Coming soon</h3>
          <p>{description}</p>
        </div>
      </section>
    </>
  );
}

import Link from "next/link";
import "./demo.css";

const careSteps = [
  {
    number: "01",
    title: "Share a little about the day",
    description: "A wellbeing update, check-in, or care note helps keep everyone connected.",
  },
  {
    number: "02",
    title: "A person reviews what changed",
    description: "Care teams can consider signals in context and decide whether follow-up is needed.",
  },
  {
    number: "03",
    title: "Keep the next step visible",
    description: "Follow-ups have an owner, and updates can be shared with family by permission.",
  },
];

export default function PublicDemo() {
  return (
    <main className="public-showcase demo-page">
      <nav className="demo-header" aria-label="Main navigation">
        <Link href="/" className="demo-brand" aria-label="SwasthSync home">
          <span className="demo-brand-icon" aria-hidden="true">♡</span>
          <span>SwasthSync</span>
        </Link>
        <Link className="button secondary demo-sign-in" href="/sign-in">
          Care workspace <span aria-hidden="true">→</span>
        </Link>
      </nav>

      <section className="demo-hero" aria-labelledby="demo-title">
        <div>
          <span className="demo-kicker">A MORE CONNECTED WAY TO CARE</span>
          <h1 id="demo-title">Care, a little earlier.<br /><em>Support, a little closer.</em></h1>
          <p>SwasthSync helps seniors, families, and care teams stay connected through thoughtful check-ins and human follow-up.</p>
          <Link className="demo-primary-link" href="/sign-in">Explore the care workspace <span aria-hidden="true">→</span></Link>
        </div>
        <div className="demo-hero-art" aria-hidden="true">
          <div className="demo-orbit demo-orbit-outer" />
          <div className="demo-orbit demo-orbit-inner" />
          <div className="demo-home-mark"><span>⌂</span><strong>Care starts<br />with a person.</strong><small>CONNECTED WITH CONSENT</small></div>
          <span className="demo-orbit-dot demo-orbit-dot-one" />
          <span className="demo-orbit-dot demo-orbit-dot-two" />
        </div>
      </section>

      <section className="demo-principles" aria-label="Care principles">
        <article><span className="demo-principle-icon" aria-hidden="true">♡</span><div><strong>People before dashboards</strong><p>Signals support a human review. They do not make diagnoses.</p></div></article>
        <article><span className="demo-principle-icon warm" aria-hidden="true">⌂</span><div><strong>Respect for independence</strong><p>Seniors can stay connected in ways that work for them.</p></div></article>
        <article><span className="demo-principle-icon blue" aria-hidden="true">✓</span><div><strong>Sharing by permission</strong><p>Family access follows the senior’s sharing choices.</p></div></article>
      </section>

      <section className="demo-approach" aria-labelledby="approach-title">
        <div className="demo-section-heading">
          <span className="demo-kicker">SMALL UPDATES. THOUGHTFUL ACTION.</span>
          <h2 id="approach-title">Care is a conversation<br />that continues.</h2>
          <p>A simple flow keeps everyday updates connected to the people who can act on them.</p>
        </div>
        <div className="demo-steps">
          {careSteps.map((step) => (
            <article key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="demo-data-note" aria-label="Public page privacy note">
        <span aria-hidden="true">◌</span>
        <p>This public overview contains no senior profiles, care records, or observation histories.</p>
      </section>

      <footer className="demo-footer">
        <Link href="/" className="demo-footer-brand">SwasthSync</Link>
        <span>Built around dignity, privacy, and human care.</span>
        <Link href="/sign-in">Open care workspace <span aria-hidden="true">→</span></Link>
      </footer>
    </main>
  );
}

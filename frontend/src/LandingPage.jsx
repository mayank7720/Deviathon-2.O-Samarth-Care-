import "./LandingPage.css";

const features = [
  {
    number: "01",
    icon: "◉",
    title: "Thoughtful monitoring",
    copy: "Understand everyday routines with activity insights designed around each person’s baseline.",
    tone: "mint",
  },
  {
    number: "02",
    icon: "⌁",
    title: "Earlier awareness",
    copy: "Notice meaningful changes and missed check-ins sooner, while keeping people in the loop.",
    tone: "lavender",
  },
  {
    number: "03",
    icon: "♡",
    title: "Human-led response",
    copy: "Bring useful context to caregivers so they can check in and decide what to do next.",
    tone: "peach",
  },
];

const steps = [
  ["Monitor", "Build a picture of everyday routines."],
  ["Understand", "Surface changes that may need attention."],
  ["Connect", "Share a timely prompt with the care team."],
  ["Respond", "Let people decide the right next step."],
];

function Brand({ light = false }) {
  return (
    <a className={`landing-brand${light ? " landing-brand-light" : ""}`} href="/" aria-label="SAARTHI AI home">
      <span className="landing-brand-mark">S</span>
      <span>SAARTHI<span className="brand-ai">.AI</span></span>
    </a>
  );
}

export default function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-nav-wrap">
          <Brand />
          <nav className="landing-nav" aria-label="Main navigation">
            <a href="#home">Home</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#about">About</a>
          </nav>
          <a className="landing-login" href="/login">Login <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <main>
        <section className="landing-hero" id="home">
          <div className="hero-glow hero-glow-one" />
          <div className="hero-glow hero-glow-two" />
          <div className="hero-inner">
            <div className="hero-copy">
              <div className="hero-kicker"><span className="kicker-dot" /> CARE THAT KEEPS YOU CLOSE</div>
              <h1>Safer living.<br /><span>Smarter care.</span></h1>
              <p className="hero-description">A little more peace of mind for families. A little more support for the people who care, every day.</p>
              <div className="hero-actions">
                <a className="landing-button landing-button-dark" href="/login">Get started <span aria-hidden="true">→</span></a>
                <a className="hero-text-link" href="#how-it-works"><span className="play-icon">▶</span> See how it works</a>
              </div>
              <div className="hero-note"><span className="note-check">✓</span> Technology that supports human care</div>
            </div>

            <div className="hero-art" aria-label="Illustration representing connected, compassionate care" role="img">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <div className="art-sun" />
              <div className="art-plant plant-left"><i /><i /><i /><b /></div>
              <div className="art-plant plant-right"><i /><i /><i /><b /></div>
              <div className="art-hill hill-back" />
              <div className="art-hill hill-front" />
              <div className="art-person person-one"><i className="person-head" /><i className="person-body" /><i className="person-leg leg-one" /><i className="person-leg leg-two" /></div>
              <div className="art-person person-two"><i className="person-head" /><i className="person-body" /><i className="person-leg leg-one" /><i className="person-leg leg-two" /></div>
              <div className="care-ring"><span>♡</span></div>
              <div className="floating-card card-check"><span className="card-icon">✓</span><span><b>All is well</b><small>A reassuring check-in</small></span></div>
              <div className="floating-card card-pulse"><span className="pulse-icon">⌁</span><span><b>Care, connected</b><small>People come first</small></span></div>
              <span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✦</span>
            </div>
          </div>
          <div className="hero-bottom"><span>BUILT AROUND PEOPLE</span><span className="bottom-line" /><span>CARE WITH CLARITY, EVERY DAY</span></div>
        </section>

        <section className="landing-intro" id="about">
          <div className="intro-label">A MORE HUMAN KIND OF SUPPORT</div>
          <h2>Helping families feel closer,<br /><span>even when they’re apart.</span></h2>
          <p>SAARTHI AI brings useful signals and caring people together. It helps teams notice routine changes and coordinate a thoughtful check-in—so technology can make room for more human connection.</p>
          <div className="intro-stats"><div><strong>24<span>/7</span></strong><small>Awareness, around the clock</small></div><div><strong>1<span> team</span></strong><small>Connected around each person</small></div><div><strong>∞</strong><small>Ways to show you care</small></div></div>
        </section>

        <section className="landing-features" id="features">
          <div className="section-topline"><span>CARE, MADE CLEARER</span><span>01 — 03</span></div>
          <div className="features-heading"><h2>Small signals.<br /><em>Meaningful care.</em></h2><p>Simple tools can help caregivers feel informed and families feel connected, without losing sight of what matters most: the person.</p></div>
          <div className="feature-grid">
            {features.map((feature) => <article className="feature-card" key={feature.number}>
              <div className="feature-card-top"><span className={`feature-icon ${feature.tone}`}>{feature.icon}</span><span className="feature-number">{feature.number}</span></div>
              <h3>{feature.title}</h3><p>{feature.copy}</p><a href="/login" aria-label={`Explore ${feature.title}`}>Explore <span>↗</span></a>
            </article>)}
          </div>
        </section>

        <section className="landing-process" id="how-it-works">
          <div className="process-copy"><div className="intro-label">HOW IT WORKS</div><h2>From noticing<br />to <span>being there.</span></h2><p>Helpful technology should make the next caring action feel clearer. SAARTHI AI helps connect the dots, while people stay in charge.</p><a className="landing-button landing-button-light" href="/login">Take a closer look <span aria-hidden="true">→</span></a></div>
          <div className="process-steps">{steps.map(([title, copy], index) => <div className="process-step" key={title}><span className="step-index">0{index + 1}</span><div><h3>{title}</h3><p>{copy}</p></div><span className="step-arrow">↗</span></div>)}</div>
        </section>

        <section className="landing-cta"><div className="cta-orb" /><div className="cta-content"><span className="intro-label">BETTER CARE STARTS WITH CONNECTION</span><h2>Let’s make room<br />for more <em>peace of mind.</em></h2><a className="landing-button landing-button-dark" href="/login">Get started <span aria-hidden="true">→</span></a></div><div className="cta-caption">Thoughtful technology. Human care.</div></section>
      </main>

      <footer className="landing-footer"><Brand light /><span>Safer living. Smarter care.</span><div><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="/login">Sign in</a></div><small>© 2026 SAARTHI AI · Prototype</small></footer>
    </div>
  );
}

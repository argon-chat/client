<!--
  Privacy Policy body — SHARED SOURCE OF TRUTH.

  Template-only SFC (no script, no external imports) so it can be copied verbatim
  into the client by client/scripts/sync-legal.ts. Rendered by privacy.astro on
  the landing (Astro renders Vue natively) and inside the client legal modal.
  Styling comes from legal.css (.legal-prose / .def-* / .legal-note / .note-*).
-->
<script setup lang="ts">
// Static legal content — no logic. The empty script-setup block makes this a
// proper module (typed default export) for Astro + vue-tsc tooling.
</script>

<template>
  <div class="legal-prose">
    <section>
      <h2>1. Welcome</h2>
      <p>We value your privacy and are committed to protecting your personal data. This Privacy Policy explains how <span class="hl">Argon Incorporated LLC</span> collects, uses, stores, protects, and shares personal data in connection with the <span class="hl">Argon Chat</span> platform.</p>
      <div class="legal-note note-green">
        <p>In simple terms &mdash; this document helps you understand <strong>what</strong> we collect, <strong>why</strong> we collect it, and <strong>how</strong> we keep it safe. Privacy should be clear and manageable, not hidden behind legal complexity.</p>
      </div>
    </section>

    <section>
      <h2>2. Information We Collect</h2>
      <p>We collect limited categories of personal data to operate <span class="hl">Argon Chat</span> effectively.</p>
      <div class="def-grid">
        <div class="def-card">
          <p class="def-term">Account Information</p>
          <p>Email address, username, display name, avatar, password, and linked credentials through Argon&rsquo;s OAuth.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Usage Information</p>
          <p>Interactions within Argon Chat (joining groups, messaging), device info, IP address, browser type.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Optional Information</p>
          <p>Profile details you choose to share &mdash; bio, linked services, and other personalizations.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Integration Data</p>
          <p>When connecting to other Argon services, we may receive your email, avatar, and username for authentication.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Website Analytics</p>
          <p>Aggregated, anonymous page-view and performance metrics collected via <strong>Cloudflare Web Analytics</strong> on our public websites (landing pages, docs, status).</p>
        </div>
        <div class="def-card">
          <p class="def-term">Diagnostics &amp; Product Analytics</p>
          <p>Error reports, performance data, and product interaction metrics (such as which features and buttons are used) collected through our self-hosted <strong>Sentry</strong> across Argon products.</p>
        </div>
      </div>
      <div class="legal-note note-green">
        <p>We <strong>do not</strong> collect sensitive categories of data (biometric, health, political beliefs) unless required by law.</p>
      </div>
      <div class="legal-note note-info">
        <p><strong>About our website analytics:</strong> Cloudflare Web Analytics does <strong>not</strong> use cookies, does not collect personal data, and does not track users across sites. It only records anonymous, aggregated metrics such as page views, referrers, and page load times. No IP addresses or device fingerprints are stored. This tool is enabled on all Argon public websites.</p>
      </div>
      <div class="legal-note note-info">
        <p><strong>About our diagnostics (Sentry):</strong> We operate a <strong>self-hosted</strong> Sentry instance across all Argon products to monitor errors and understand how the products are used &mdash; including interactions such as clicks and navigation. On our <strong>public websites</strong> this telemetry is <strong>anonymous</strong>: we do not record who performed an action. When you are <strong>signed in</strong> to an Argon product, these diagnostic and usage events are associated with your account, so we can investigate issues affecting you and improve the features you actually use. Because Sentry is self-hosted, this data stays within Argon&rsquo;s own infrastructure and is never sold or shared with advertisers.</p>
      </div>
    </section>

    <section>
      <h2>3. How We Use Your Information</h2>
      <p>Your information is used to ensure <span class="hl">Argon Chat</span> functions properly and securely:</p>
      <ul>
        <li><strong>Provide and operate</strong> &mdash; ensuring you can log in, communicate, and use platform features</li>
        <li><strong>Personalize</strong> &mdash; tailoring interface and notifications to your preferences</li>
        <li><strong>Communicate</strong> &mdash; sending service updates, policy changes, or account notices</li>
        <li><strong>Promote Argon services</strong> &mdash; displaying notices about our own features within the platform</li>
        <li><strong>Safety and compliance</strong> &mdash; enforcing community standards and fulfilling legal obligations</li>
      </ul>
      <div class="legal-note note-info">
        <p>We do not run third-party targeted ads. We do not share your data with external advertising networks.</p>
      </div>
    </section>

    <section>
      <h2>4. GDPR Compliance</h2>
      <p><span class="hl">Argon Incorporated LLC</span> is fully aligned with the GDPR and processes personal data in accordance with its principles of transparency, fairness, and accountability.</p>
      <div class="def-grid cols-1">
        <div class="def-card">
          <p class="def-term">Lawful Basis (Art. 6 GDPR)</p>
          <p>Consent, contract performance, legal obligations, legitimate interests, or protection of vital interests.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Data Minimization &amp; Purpose Limitation</p>
          <p>We collect only the minimum data required and use it strictly for the stated purposes.</p>
        </div>
        <div class="def-card">
          <p class="def-term">User Rights (EEA)</p>
          <p>Access, rectification, erasure, restriction of processing, data portability, and objection to processing.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Data Protection Officer</p>
          <p>Argon maintains an internal DPO responsible for GDPR compliance and data protection inquiries.</p>
        </div>
        <div class="def-card">
          <p class="def-term">International Transfers</p>
          <p>For transfers outside the EEA, we apply Standard Contractual Clauses (SCCs) or other approved mechanisms.</p>
        </div>
      </div>
    </section>

    <section>
      <h2>5. User-Generated Content</h2>
      <div class="legal-note note-green">
        <p><strong>You own your content.</strong> We do not use or repurpose user-generated content for our own projects, commercial purposes, or promotional materials.</p>
      </div>
      <p>Our handling of UGC is limited to storing, transmitting, or displaying it so that the Service can function properly. Messages are processed to deliver them securely to recipients. We never extract or analyze content for advertising or unrelated analytics.</p>
    </section>

    <section>
      <h2>6. How We Disclose Information</h2>
      <p>We only share personal data when it is necessary and lawful:</p>
      <ul>
        <li><strong>With your consent</strong> &mdash; for integrations or linked services you authorize</li>
        <li><strong>With Argon services</strong> &mdash; for unified authentication across the Argon ecosystem</li>
        <li><strong>For legal compliance</strong> &mdash; when required by law or valid legal process</li>
        <li><strong>For security</strong> &mdash; to investigate Terms violations or protect users and the platform</li>
      </ul>
      <div class="legal-note note-green">
        <p>We <strong>do not sell, rent, or trade</strong> personal data under any circumstances.</p>
      </div>
    </section>

    <section>
      <h2>7. Data Retention</h2>
      <p>We retain your personal data only as long as necessary to provide the Service, comply with legal obligations, or resolve disputes.</p>
      <div class="legal-note note-info">
        <p>When you request <strong>account deletion</strong>, we will remove or anonymize your personal information, except where retention is legally required (e.g., fraud prevention).</p>
      </div>
    </section>

    <section>
      <h2>8. Data Protection &amp; Security</h2>
      <p>Protecting your information is a core operational priority.</p>
      <div class="def-grid cols-1">
        <div class="def-card">
          <p class="def-term">Encryption &amp; Access Control</p>
          <p>Secure storage using encryption at rest and strict access policies.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Infrastructure Safeguards</p>
          <p>Designed to prevent unauthorized access, leaks, or breaches.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Regular Audits</p>
          <p>Security audits, monitoring, and updates to address potential risks.</p>
        </div>
      </div>
      <p>While no system can be fully secure, Argon is committed to continuous improvement of its security capabilities.</p>
    </section>

    <section>
      <h2>9. Your Rights and Controls</h2>
      <p>Privacy is built on control. You have the following rights:</p>
      <div class="def-grid">
        <div class="def-card">
          <p class="def-term">Access &amp; Portability</p>
          <p>Request a copy of your data in a structured, machine-readable format.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Correction</p>
          <p>Update inaccurate or incomplete information.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Deletion</p>
          <p>Request deletion of personal data, except minimal info required for legal purposes.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Privacy Controls</p>
          <p>Manage visibility and hide profile details from other users.</p>
        </div>
        <div class="def-card">
          <p class="def-term">Withdraw Consent</p>
          <p>Revoke optional permissions at any time.</p>
        </div>
      </div>
      <p>Requests can be made through account settings or by contacting us directly.</p>
    </section>

    <section>
      <h2>10. Third-Party Integrations</h2>
      <p><span class="hl">Argon Chat</span> may offer integrations through our secure <strong>OAuth</strong> framework. These may access your email, avatar, display name, and username solely for authentication.</p>
      <p>Our public websites use <strong>Cloudflare Web Analytics</strong>, a privacy-first analytics service provided by Cloudflare, Inc. It collects only anonymous, aggregated data (page views, referrers, performance metrics) without cookies, personal identifiers, or cross-site tracking. Cloudflare processes this data under its own <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener" class="legal-email-link">Privacy Policy</a>.</p>
      <div class="legal-note note-info">
        <p>We do not share personal data with unrelated third-party advertising networks or data brokers.</p>
      </div>
    </section>

    <section>
      <h2>11. International Data Transfers</h2>
      <p>If you access <span class="hl">Argon Chat</span> from outside the jurisdiction where our servers are located, your data may be transferred across borders. We ensure that such transfers are protected with industry-standard legal safeguards.</p>
      <p>Where applicable, we use <strong>Standard Contractual Clauses</strong> to maintain compliance with international data protection laws.</p>
    </section>

    <section>
      <h2>12. Children&rsquo;s Privacy</h2>
      <div class="legal-note note-danger">
        <p><span class="hl">Argon Chat</span> is <strong>not intended for children</strong> under the minimum age required by local law (typically 13). We do not knowingly collect personal data from children below this age.</p>
      </div>
      <p>If a parent or guardian believes their child has provided personal data, they should contact us for prompt removal.</p>
    </section>

    <section>
      <h2>13. Changes to This Policy</h2>
      <p>We may update this Privacy Policy periodically. When material changes occur, we will provide clear notice via in-app message or email. Continued use after changes take effect constitutes acceptance.</p>
    </section>

    <section>
      <h2>14. Contact Us</h2>
      <p>If you have questions, concerns, or requests related to this Privacy Policy:</p>
      <div class="legal-contact">
        <p><strong>Argon Incorporated LLC</strong></p>
        <p>2 Sasna Tsrer street, Yerevan, Armenia</p>
        <p>Email: <a class="legal-email-link" href="mailto:support@argon.gl">support@argon.gl</a></p>
      </div>
    </section>
  </div>
</template>

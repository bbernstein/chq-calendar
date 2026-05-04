// Shared global type for Google reCAPTCHA v3. Loaded by pages that gate
// submissions with a captcha (frontend/src/app/feedback/page.tsx and
// frontend/src/app/publish/apply/page.tsx). Declaring here once avoids
// the "All declarations of 'grecaptcha' must have identical modifiers"
// TS error that two divergent inline declarations would cause.
//
// This is an ambient declaration file: TypeScript picks it up
// automatically because it lives under src/ and ends in .d.ts. No
// `import` is required from consumers.

interface Window {
  grecaptcha: {
    ready: (callback: () => void) => void;
    execute: (siteKey: string, options: { action: string }) => Promise<string>;
  };
}

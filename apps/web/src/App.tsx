import { ApiStatus } from './ApiStatus';

export function App() {
  return (
    <>
      <header className="site-header">
        <h1>HospitalOS</h1>
        <p className="tagline">Outpatient hospital management system</p>
      </header>
      <main>
        <p className="notice" role="note">
          Development build. Synthetic data only. Not for real patient information.
        </p>
        <ApiStatus />
      </main>
    </>
  );
}

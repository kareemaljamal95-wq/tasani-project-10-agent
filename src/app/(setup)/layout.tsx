/**
 * Setup shell.
 *
 * Onboarding lives outside the (dashboard) group on purpose: the dashboard
 * layout redirects unfinished accounts *to* onboarding, so hosting onboarding
 * under that same layout would redirect it to itself.
 */
export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-950 py-12 px-4">{children}</div>
  );
}

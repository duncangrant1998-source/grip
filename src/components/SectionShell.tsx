/**
 * Two-column shell for a department that has its own sub-navigation: the
 * page content sits on the left, and the list of sub-pages sits in a
 * vertical sidebar on the right (the main top-level nav stays in AppNav,
 * above both). Stacks to a single column on narrow screens, with the nav
 * shown first there so it isn't buried below a long page.
 *
 * `nav` is optional so a page that only sometimes has sub-navigation (an
 * order list some roles see tabs for and some don't) can pass it
 * conditionally without having to duplicate its content JSX.
 */
export function SectionShell({
  nav,
  children,
}: {
  nav?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!nav) return <>{children}</>;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="order-2 min-w-0 flex-1 lg:order-1">{children}</div>
      <div className="order-1 lg:order-2 lg:w-56 lg:shrink-0">{nav}</div>
    </div>
  );
}

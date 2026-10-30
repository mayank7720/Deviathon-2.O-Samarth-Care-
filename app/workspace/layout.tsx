import Home from '../page';

// The authenticated shell lives in this fixed layout so changing a view does
// not recreate authentication, bootstrap data or the navigation sidebar.
export default function WorkspaceLayout({children}:{children:React.ReactNode}) {
  return <>{children}<Home/></>;
}

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/**
 * Thin reactive presentation layer around existing app.js routing.
 * All navigation decisions continue to go through navigateController().
 */
function readRouteState() {
  const known = window.__PFC_SHELL_ROUTE_STATE__;
  if (known && typeof known.title === 'string') {
    return { path:String(known.path || '/'), title:known.title };
  }
  return { path:window.location.pathname, title:'Dashboard' };
}

function WorkspaceTrail() {
  const [route,setRoute] = useState(readRouteState);
  useEffect(()=>{
    const update=(event)=>setRoute(event?.detail?.title ? {
      path:String(event.detail.path || '/'),
      title:String(event.detail.title)
    } : readRouteState());
    window.addEventListener('pfc:shell-route-state',update);
    // Direct route-load may have completed while the first Preact effect ran.
    update();
    return ()=>window.removeEventListener('pfc:shell-route-state',update);
  },[]);
  function dashboard() {
    window.dispatchEvent(new CustomEvent('pfc:shell-navigate',{detail:{route:'/'}}));
  }
  // The Dashboard is the root of the workspace. A breadcrumb reading
  // Workspace / Dashboard above a large Dashboard heading repeats itself.
  // Use a small section eyebrow on the home route; retain a navigable
  // breadcrumb for deeper routes.
  if(route.path==='/') {
    return <div class="workspace-trail-home" data-preact-workspace-trail>
      <span class="workspace-trail-parent">Workspace</span>
    </div>;
  }
  return (
    <nav aria-label="Breadcrumb" data-preact-workspace-trail>
      <button type="button" class="workspace-trail-link"
        aria-label="Go to dashboard" onClick={dashboard}>Workspace</button>
      <span aria-hidden="true">/</span>
      <span class="workspace-trail-current" aria-current="page">{route.title}</span>
    </nav>
  );
}

export function initWorkspaceShell() {
  const root=document.querySelector('#workspaceTrailRoot');
  if(!root) return;
  render(<WorkspaceTrail />,root);
  window.__PFC_PREACT_SHELL__=true;
}

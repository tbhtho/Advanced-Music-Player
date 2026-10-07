
/** Native minimize/hide can precede or bypass Chromium's Page Visibility update. */
let nativeVisible=true;
let generation=0;
let revision=0;
let disconnect:(()=>void)|undefined;
const listeners=new Set<()=>void>();
export function isWindowActive(): boolean {return !document.hidden && nativeVisible;}
export function subscribeWindowActivity(callback:()=>void):()=>void {
  listeners.add(callback);
  if(listeners.size===1){
    const current=++generation;revision=0;
    const notify=()=>{for(const listener of listeners)listener();};
    document.addEventListener("visibilitychange",notify);
    const bridge=window.spotCloud?.windowControls;
    const unsubscribe=bridge?.onVisibilityChanged?.(visible=>{revision++;nativeVisible=visible;notify();});
    const requestedAt=revision;
    void bridge?.getState().then(state=>{
      if(current===generation && requestedAt===revision && typeof state.isVisible==="boolean"){
        nativeVisible=state.isVisible;notify();
      }
    }).catch(()=>undefined);
    disconnect=()=>{document.removeEventListener("visibilitychange",notify);unsubscribe?.();};
  }
  callback();
  return ()=>{
    listeners.delete(callback);
    if(listeners.size===0){generation++;disconnect?.();disconnect=undefined;nativeVisible=true;}
  };
}

import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import type { AppUpdateState } from "@/lib/appUpdates";

function useAppUpdates() {
  const [state,setState]=useState<AppUpdateState>({phase:"unsupported",currentVersion:"",message:"Updates are available in the installed Windows app."});
  const [failure,setFailure]=useState("");
  useEffect(()=>{
    const bridge=window.spotCloud?.updates;
    if(!bridge)return;
    let active=true, revision=0;
    const disconnect=bridge.onChanged(next=>{revision++;if(active){setState(next);setFailure("");}});
    void bridge.getState().then(next=>{if(active&&revision===0)setState(next);}).catch(()=>{if(active)setFailure("Could not read the update status.");});
    return ()=>{active=false;disconnect();};
  },[]);
  const run=async(action:()=>Promise<unknown>)=>{
    setFailure("");try{await action();}catch{setFailure("Could not reach the updater. Please try again.");}
  };
  return {state,failure,run,bridge:window.spotCloud?.updates};
}
export function UpdateNotice() {
  const {state}=useAppUpdates();
  if(!["available","downloading","downloaded"].includes(state.phase))return null;
  return <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--edge)] px-5 py-2 text-sm" role="status">
    <span>{state.phase==="downloaded" ? "AMP update ready to install." : state.phase==="downloading" ? "Downloading AMP update: "+(state.percent??0)+"%" : "AMP "+state.availableVersion+" is available."}</span>
    <NavLink to="/settings" className="shrink-0 text-[var(--acid)]">View update</NavLink>
  </div>;
}
export function AppUpdatesCard() {
  const {state,failure,run,bridge}=useAppUpdates();
  const busy=state.phase==="checking"||state.phase==="downloading";
  return <section className="amp-section" aria-label="AMP updates">
    <h2 className="text-lg font-semibold">AMP updates</h2>
    {state.currentVersion && <p className="mt-1 text-xs text-[var(--muted)]">Installed version {state.currentVersion}</p>}
    <p className="mt-3 text-sm leading-6 text-[var(--muted)]" role="status">{failure||state.message}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="rounded-full border border-[var(--edge)] px-4 py-2 text-sm disabled:opacity-40" disabled={!bridge||busy||state.phase==="unsupported"||state.phase==="downloaded"} onClick={()=>bridge&&void run(()=>bridge.check())}>Check for updates</button>
      {state.availableVersion && (state.phase==="available"||state.phase==="error") && <button className="rounded-full bg-[var(--acid)] px-4 py-2 text-sm text-[var(--bg)]" onClick={()=>bridge&&void run(()=>bridge.download())}>Download AMP {state.availableVersion}</button>}
      {state.phase==="downloaded" && <button className="rounded-full bg-[var(--acid)] px-4 py-2 text-sm text-[var(--bg)]" onClick={()=>bridge&&void run(()=>bridge.install())}>Restart and update</button>}
    </div>
    {state.phase==="downloading" && <progress className="mt-4 w-full accent-[var(--acid)]" aria-label="AMP update download" value={state.percent??0} max={100}/>}
    {state.phase!=="unsupported" && <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Checks run at startup and every six hours. Downloads start when you choose; installing asks for confirmation and stops playback.</p>}
  </section>;
}

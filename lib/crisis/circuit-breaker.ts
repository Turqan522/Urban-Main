export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
export type RoutingResult<T> = { data: T; isFallback: boolean; reason?: string; circuit: CircuitState };
export class RoutingCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private lastFailureTime = 0;
  private probeInFlight = false;
  constructor(private readonly timeoutMs = 5000, private readonly cooldownMs = 30000, private readonly clock = () => Date.now()) {}
  get status() { return this.state; }
  async executeWithFallback<T>(externalCall:(signal:AbortSignal)=>Promise<T>, fallbackCall:()=>Promise<T>|T):Promise<RoutingResult<T>> {
    if (this.state==="OPEN") {
      if (this.clock()-this.lastFailureTime < this.cooldownMs) return { data:await fallbackCall(), isFallback:true, reason:"Circuit Open", circuit:"OPEN" };
      this.state="HALF_OPEN";
    }
    if (this.probeInFlight) return { data:await fallbackCall(), isFallback:true, reason:"Half-open probe in progress", circuit:"HALF_OPEN" };
    this.probeInFlight=true;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const timeout=new Promise<never>((_,reject)=>{ timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error("Routing timeout"),{name:"AbortError"}));},this.timeoutMs); });
      const data=await Promise.race([Promise.resolve().then(()=>externalCall(controller.signal)),timeout]);
      this.state="CLOSED";
      return {data,isFallback:false,circuit:"CLOSED"};
    } catch(error) {
      this.state="OPEN";this.lastFailureTime=this.clock();
      return {data:await fallbackCall(),isFallback:true,reason:error instanceof Error && error.name==="AbortError"?"Timeout > 5000ms":error instanceof Error?error.message:"External routing unavailable",circuit:"OPEN"};
    } finally { if(timer)clearTimeout(timer);this.probeInFlight=false; }
  }
}
export const routingCircuit=new RoutingCircuitBreaker();

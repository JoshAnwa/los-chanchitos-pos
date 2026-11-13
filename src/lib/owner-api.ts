import {createClient} from "./supabase/client";
import {runOrderRequest,ORDER_REQUEST_TIMEOUT_MESSAGE} from "./order-request";
import {ownerError,type InventoryAction,type InventoryDashboard,type BusinessSettings,type SalesReport} from "./owner-data";
async function rpc<T>(name:string,args?:Record<string,unknown>):Promise<T> {
  try {
    const {data,error}=await runOrderRequest(signal=>createClient().rpc(name,args).abortSignal(signal));
    if(error) throw new Error(ownerError(error));
    return data as T;
  } catch(error) {
    if(error instanceof Error&&error.message!==ORDER_REQUEST_TIMEOUT_MESSAGE&&!(error instanceof TypeError))throw error;
    throw new Error("La conexión no confirmó el resultado. Puede haberse guardado: reintenta exactamente lo mismo o actualiza antes de cambiar datos.");
  }
}
export const getInventory=()=>rpc<InventoryDashboard>("get_inventory_dashboard");
export const getBusiness=()=>rpc<BusinessSettings>("get_business_settings");
export const getSales=(from:string,to:string)=>rpc<SalesReport>("get_sales_report",{p_from:from,p_to:to});
export const changeInventory=(action:InventoryAction,id:string,version:number,requestId:string,data:Record<string,unknown>)=>rpc<{id:string;ok:boolean}>("inventory_action",{p_action:action,p_id:id,p_version:version,p_request_id:requestId,p_data:data});

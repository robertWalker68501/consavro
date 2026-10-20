"use server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { requireBusinessPermission } from "@/lib/business-access";
type PickupProcessingStatus = "PENDING"|"IN_PROGRESS"|"READY"|"ON_HOLD";

type Result = {ok:true;inventoryItemId?:string}|{ok:false;error:string};
const path=(businessId:string,pickupId:string)=>`/dashboard/businesses/${businessId}/pickups/${pickupId}`;
export async function setPickupItemProcessingStatus(businessId:string,pickupId:string,itemId:string,status:PickupProcessingStatus):Promise<Result>{
 await requireBusinessPermission(businessId,"operations:write");
 if(!["PENDING","IN_PROGRESS","READY","ON_HOLD"].includes(status)) return {ok:false,error:"Invalid processing status."};
 const pickup=await prisma.sellerPickup.findFirst({where:{id:pickupId,businessId},select:{status:true}});
 if(!pickup || pickup.status==="COMPLETED")return {ok:false,error:"Pickup is not editable."};
 const updated=await prisma.sellerPickupItem.updateMany({where:{id:itemId,pickupId,businessId,inventoryItemId:null},data:{processingStatus:status}});
 if(!updated.count)return {ok:false,error:"Item not found or already transferred to inventory."};
 revalidatePath(path(businessId,pickupId));return {ok:true};
}
export async function transferPickupItemToInventory(businessId:string,pickupId:string,itemId:string):Promise<Result>{
 await requireBusinessPermission(businessId,"operations:write");
 const result=await prisma.$transaction(async tx=>{
  const item=await tx.sellerPickupItem.findFirst({where:{id:itemId,pickupId,businessId},include:{pickup:{select:{clientId:true,status:true}}}});
  if(item?.pickup.status==="COMPLETED")return {ok:false as const,error:"Pickup is not editable."};
  if(!item)return {ok:false as const,error:"Collected item not found."};
  if(item.inventoryItemId)return {ok:false as const,error:"This item is already in inventory."};
  if(item.processingStatus!=="READY")return {ok:false as const,error:"Mark the item Ready before transferring."};
  if(item.condition==="UNKNOWN" || item.completeness==="UNKNOWN" || item.askingPrice===null)return {ok:false as const,error:"Condition, completeness and asking price are required before inventory transfer."};
  const condition=item.condition==="USED"?"USED" as const:"NEW_OPEN_BOX" as const;
  const completeness=item.completeness==="INCOMPLETE"?"INCOMPLETE" as const:"COMPLETE" as const;
  const inventory=await tx.inventoryItem.create({data:{businessId,name:item.name,quantity:item.quantity,description:[item.description,item.inspectionNotes].filter(Boolean).join("\n\n")||null,setNumber:item.setNumber,theme:item.theme,legoSetId:item.legoSetId,clientId:item.pickup.clientId,condition,completeness,askingPrice:item.askingPrice,estimatedValue:item.estimatedValue,status:"IN_STOCK"}});
  const linked=await tx.sellerPickupItem.updateMany({where:{id:itemId,pickupId,businessId,inventoryItemId:null},data:{inventoryItemId:inventory.id}});
  if(linked.count!==1)throw new Error("Inventory transfer conflict");
  return {ok:true as const,inventoryItemId:inventory.id};
 });
 revalidatePath(path(businessId,pickupId));revalidatePath(`/dashboard/businesses/${businessId}/inventory`);return result;
}

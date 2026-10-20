'use server';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { pickupItemSchema } from '@/lib/validations/seller-pickup-item';

type Result = {ok:true}|{ok:false;error:string};
const path=(businessId:string,pickupId:string)=>`/dashboard/businesses/${businessId}/pickups/${pickupId}`;
export async function savePickupItem(businessId:string,pickupId:string,itemId:string|null,input:unknown):Promise<Result>{
  await requireBusinessPermission(businessId,'operations:write');
  const parsed=pickupItemSchema.safeParse(input);
  if(!parsed.success) return {ok:false,error:parsed.error.issues[0]?.message??'Invalid item.'};
  const v=parsed.data;
  const pickup=await prisma.sellerPickup.findFirst({where:{id:pickupId,businessId},select:{status:true}});
  if(!pickup || pickup.status==='COMPLETED') return {ok:false,error:'Pickup is not editable.'};
  let set:null|{id:string;name:string;setNumber:string;theme:string|null}=null;
  if(v.kind==='CATALOG_SET') {
    set=await prisma.legoSet.findUnique({where:{id:v.legoSetId!},select:{id:true,name:true,setNumber:true,theme:true}});
    if(!set) return {ok:false,error:'Catalog set not found.'};
    if(v.name!==set.name || v.setNumber!==set.setNumber) return {ok:false,error:'Catalog details do not match the selected set.'};
  }
  const data={kind:v.kind,legoSetId:set?.id??null,name:v.name,setNumber:set?.setNumber??(v.setNumber||null),theme:set?.theme??(v.theme||null),quantity:v.quantity,description:v.description||null,
    condition:v.condition,completeness:v.completeness,inspectionNotes:v.inspectionNotes||null,
    estimatedValue:v.estimatedValue||null,askingPrice:v.askingPrice||null};
  if(itemId){
    const existing = await prisma.sellerPickupItem.findFirst({where:{id:itemId,pickupId,businessId},select:{inventoryItemId:true}});
    if(existing?.inventoryItemId) return {ok:false,error:"Inventory-linked items cannot be edited."};
    const result=await prisma.sellerPickupItem.updateMany({where:{id:itemId,pickupId,businessId},data});
    if(!result.count) return {ok:false,error:'Item not found.'};
  } else await prisma.sellerPickupItem.create({data:{...data,pickupId,businessId}});
  revalidatePath(path(businessId,pickupId));return {ok:true};
}
export async function deletePickupItem(businessId:string,pickupId:string,itemId:string):Promise<Result>{
  await requireBusinessPermission(businessId,'operations:write');
  const pickup=await prisma.sellerPickup.findFirst({where:{id:pickupId,businessId},select:{status:true}});
  if(!pickup || pickup.status==='COMPLETED') return {ok:false,error:'Pickup is not editable.'};
  const existing = await prisma.sellerPickupItem.findFirst({where:{id:itemId,pickupId,businessId},select:{inventoryItemId:true}});
  if(existing?.inventoryItemId) return {ok:false,error:"Inventory-linked items cannot be removed."};
  const result=await prisma.sellerPickupItem.deleteMany({where:{id:itemId,pickupId,businessId}});
  if(!result.count) return {ok:false,error:'Item not found.'};
  revalidatePath(path(businessId,pickupId));return {ok:true};
}

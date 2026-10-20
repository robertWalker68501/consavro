import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import {requireBusinessPermission} from '@/lib/business-access';
import {DashboardBreadcrumbs} from '@/components/navigation/DashboardBreadcrumbs';
import {SellerPickupItemForm} from '@/components/business/SellerPickupItems';
async function ItemPageContent({params}:{params:Promise<{businessId:string;pickupId:string}>}){
 const {businessId,pickupId}=await params;
 const {business}=await requireBusinessPermission(businessId,'operations:write');
 const pickup=await prisma.sellerPickup.findFirst({where:{id:pickupId,businessId},select:{status:true}});
 if(!pickup||pickup.status==='COMPLETED')notFound();
 const base=`/dashboard/businesses/${businessId}/pickups/${pickupId}`;
 return <main className="app-page"><DashboardBreadcrumbs items={[{label:business.name,href:`/dashboard/businesses/${businessId}`},{label:'Seller pickups',href:`/dashboard/businesses/${businessId}/pickups`},{label:'Pickup details',href:base},{label:'Add collected item'}]}/><h1 className="app-title mt-7">Add collected item</h1><p className="mt-2"><Link href={base}>Back to pickup</Link></p><SellerPickupItemForm businessId={businessId} pickupId={pickupId}/></main>;
}

export default function Page({params}:{params:Promise<{businessId:string;pickupId:string}>}){
 return <Suspense fallback={<main className="app-page"><p className="text-muted-foreground">Loading collected item…</p></main>}><ItemPageContent params={params}/></Suspense>;
}

import { redirect } from "next/navigation";

export default function CRMMarketplaceTenderRedirectPage({
  params,
}: {
  params: { tenderId: string };
}) {
  redirect(`/marketplace/discover/${params.tenderId}`);
}

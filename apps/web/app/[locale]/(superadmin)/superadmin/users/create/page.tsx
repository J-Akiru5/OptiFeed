import { NewAccountForm } from "@/components/superadmin/new-account-form";
import { listOrgs } from "@/lib/actions/superadmin";

export default async function CreatePlatformUserPage() {
	const orgs = await listOrgs();

	return <NewAccountForm orgs={orgs.map((o) => ({ id: o.id, name: o.name, type: o.type }))} />;
}

import { NewAccountForm } from "@/components/superadmin/new-account-form";
import { listOrgOptions } from "@/lib/actions/superadmin";

export default async function CreatePlatformUserPage() {
	const orgs = await listOrgOptions();

	return <NewAccountForm orgs={orgs} />;
}

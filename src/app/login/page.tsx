import Account, { metadata } from "../account/page";
export { metadata };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Account
      searchParams={Promise.resolve({ ...(await searchParams), mode: "login" })}
    />
  );
}

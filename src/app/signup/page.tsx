import Account, { metadata } from "../account/page";
export { metadata };
export default function Signup() {
  return <Account searchParams={Promise.resolve({ mode: "register" })} />;
}

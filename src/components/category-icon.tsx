import {
  ShieldCheck,
  LayoutGrid,
  Layers,
  BriefcaseBusiness,
  Palette,
  Code2,
  CirclePlay,
  MessageCircle,
  Users,
  Camera,
  PhoneCall,
  Mail,
  MessageSquarePlus,
  Headphones,
  Clapperboard,
} from "lucide-react";
const icons = {
  shield: ShieldCheck,
  grid: LayoutGrid,
  layers: Layers,
  briefcase: BriefcaseBusiness,
  palette: Palette,
  code: Code2,
  play: CirclePlay,
  message: MessageCircle,
  users: Users,
  camera: Camera,
  phone: PhoneCall,
  mail: Mail,
  "message-plus": MessageSquarePlus,
  headphones: Headphones,
  video: Clapperboard,
};
export function CategoryIcon({
  icon,
  size = 22,
}: {
  icon: string;
  size?: number;
}) {
  const Icon = Object.hasOwn(icons, icon)
    ? icons[icon as keyof typeof icons]
    : LayoutGrid;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}

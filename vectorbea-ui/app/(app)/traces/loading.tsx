import { BeeLoader } from "@/components/ui/bee-loader";

export default function TracesLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <BeeLoader />
    </div>
  );
}

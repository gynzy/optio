import { TaskList } from "@/components/task-list";
import Link from "next/link";
import { Plus } from "lucide-react";

export default function TasksPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Tasks</h1>
        <Link
          href="/tasks/new"
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-sm hover:bg-primary-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Task
        </Link>
      </div>
      <TaskList />
    </div>
  );
}

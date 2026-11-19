// Starter spines for new docs. `icon` names come from js/ui/icon-paths.js.
export const TEMPLATES = [
  {
    id: "blank",
    name: "Blank",
    icon: "file-plus",
    blurb: "Start empty. Type #Topic to add topics as you go.",
    sections: [],
  },
  {
    id: "lecture",
    name: "Lecture notes",
    icon: "graduation-cap",
    blurb: "Course lecture with key terms and open questions.",
    sections: ["Overview", "Key concepts", "Definitions", "Examples", "Questions to review"],
  },
  {
    id: "meeting",
    name: "Team meeting",
    icon: "presentation",
    blurb: "Agenda-driven meeting with decisions and action items.",
    sections: ["Updates", "Discussion", "Decisions", "Action items"],
  },
  {
    id: "study",
    name: "Study group",
    icon: "book-open",
    blurb: "Split a chapter or exam guide and fill the gaps together.",
    sections: ["Main ideas", "Formulas & facts", "Practice problems", "Confusing parts"],
  },
  {
    id: "project",
    name: "Project sync",
    icon: "briefcase",
    blurb: "Status, blockers and next steps for a group project.",
    sections: ["Progress", "Blockers", "Next steps", "Deadlines"],
  },
  {
    id: "agenda",
    name: "Paste an agenda",
    icon: "clipboard-list",
    blurb: "Each line of your agenda becomes a topic.",
    sections: null,
  },
];

import { createContext, useContext } from "react";
import { hasLocalManagement, type WorkMode } from "../../../../../backend/src/work-mode.js";
export const WorkModeContext = createContext<WorkMode>("lead");
export const useLocalManagement = () =>
  hasLocalManagement({ workMode: useContext(WorkModeContext) });

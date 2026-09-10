import React from 'react';
import { Modal } from './Modal';
import { ChatModalPurpose } from '../types';
import { ChatInterface } from './ChatInterface';
import type { GuidedProjectData } from '../services/ai';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (data: GuidedProjectData) => void;
  purpose: ChatModalPurpose;
  title: string;
  initialPrompt: string;
  projectId?: string; // ID para persistencia
  contextData?: string; // Contexto extra (ej. contenido de un artefacto)
}

export const ChatModal: React.FC<ChatModalProps> = ({ 
    isOpen, 
    onClose, 
    onComplete, 
    purpose, 
    title, 
    initialPrompt,
    projectId,
    contextData
}) => {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <ChatInterface
        onComplete={onComplete}
        purpose={purpose}
        initialPrompt={initialPrompt}
        projectId={projectId}
        contextData={contextData}
        heightClass="h-[70vh]"
      />
    </Modal>
  );
};

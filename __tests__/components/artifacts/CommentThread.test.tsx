import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { CommentThread } from '../../../components/artifacts/CommentThread';
import { artifactReviewService } from '../../../services/review/artifactReviewService';

const author = { id: 'u1', name: 'Ada' };

describe('CommentThread', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('shows an empty state when there are no comments', () => {
        render(<CommentThread artifactId="a1" projectId="p1" author={author} />);
        expect(screen.getByText('Sin comentarios todavía')).toBeInTheDocument();
    });

    it('publishes a new comment via the composer', () => {
        render(<CommentThread artifactId="a1" projectId="p1" author={author} />);
        const textarea = screen.getByLabelText('Nuevo comentario');
        fireEvent.change(textarea, { target: { value: 'Bloqueo de seguridad detectado' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publicar comentario' }));
        expect(screen.getByText('Bloqueo de seguridad detectado')).toBeInTheDocument();
        expect(artifactReviewService.listComments('a1')).toHaveLength(1);
    });

    it('renders comments that already exist in the store', () => {
        artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'Comentario previo', author,
        });
        render(<CommentThread artifactId="a1" projectId="p1" author={author} />);
        expect(screen.getByText('Comentario previo')).toBeInTheDocument();
    });

    it('filters by resolved status', () => {
        artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'A', author,
        });
        const second = artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'B', author,
        });
        artifactReviewService.setCommentStatus(second.id, 'resolved');
        render(<CommentThread artifactId="a1" projectId="p1" author={author} initialStatusFilter="resolved" />);
        expect(screen.queryByText('A')).not.toBeInTheDocument();
        expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('disables the publish button while the draft is empty', () => {
        render(<CommentThread artifactId="a1" projectId="p1" author={author} />);
        expect(screen.getByRole('button', { name: 'Publicar comentario' })).toBeDisabled();
    });

    it('omits the composer in read-only mode', () => {
        artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'Solo lectura', author,
        });
        render(<CommentThread artifactId="a1" projectId="p1" author={author} readOnly />);
        expect(screen.queryByRole('button', { name: 'Publicar comentario' })).not.toBeInTheDocument();
        // Existing comment still visible.
        expect(screen.getByText('Solo lectura')).toBeInTheDocument();
    });

    it('adds a reply and increases the thread length', () => {
        const parent = artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'parent', author,
        });
        render(<CommentThread artifactId="a1" projectId="p1" author={author} />);
        const replyField = screen.getByLabelText(`Responder al comentario de ${parent.author.name}`);
        fireEvent.change(replyField, { target: { value: 'mi respuesta' } });
        const card = replyField.closest('li');
        expect(card).toBeTruthy();
        const replyButton = within(card as HTMLElement).getByRole('button', { name: 'Responder' });
        fireEvent.click(replyButton);
        expect(screen.getByText('mi respuesta')).toBeInTheDocument();
    });
});

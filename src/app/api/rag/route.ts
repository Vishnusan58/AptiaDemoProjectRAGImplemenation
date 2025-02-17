import { NextResponse } from 'next/server';
import { queryRAGSystem } from '../../../utils/ragHelper';

export async function POST(req: Request) {
    try {
        const { message, planName } = await req.json();

        if (!message?.trim()) {
            return NextResponse.json(
                { type: 'error', message: 'Please enter a question' },
                { status: 400 }
            );
        }

        const response = await queryRAGSystem(message, planName);

        return NextResponse.json(response, { status: response.type === 'error' ? 500 : 200 });

    } catch (error) {
        console.error('Error processing request:', error);
        return NextResponse.json(
            { type: 'error', message: 'Error processing request' },
            { status: 500 }
        );
    }
}

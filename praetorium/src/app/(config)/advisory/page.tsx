'use client';

import { Card } from '@/components/ui/card';
import AdvisoryClient from '@/components/advisory/AdvisoryClient';

export default function AdvisoryPage() {
  return (
    <div className="space-y-6">
      <Card>
        <Card.Body className="p-0">
          <AdvisoryClient />
        </Card.Body>
      </Card>
    </div>
  );
}

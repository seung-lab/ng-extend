import edits10 from './images/badges/edits10.png';
import edits100 from './images/badges/edits100.png';
import edits1000000 from './images/badges/edits1000000.png';

const badges = [edits10, edits100, edits1000000];

const badgeDict: any = {};
for (const badge of badges) {
    const badgeName = (badge as string).split('-')[0].substring(2);
    badgeDict[badgeName] = badge;
}
export default badgeDict;

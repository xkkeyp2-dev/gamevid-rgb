window.GAMEVID_CONFIG = {
    // Google Cloud Console > APIs & Services > Credentials > API key
    // YouTube Data API v3 etkin olmali.
    youtubeApiKey: 'AIzaSyBRjGkLRXmG8YHVNDfHRIxU--ZhCTwBHUE',

    defaultVideoLimit: 12,

    channels: [
        { channelHandle: '@dogukanadaltvo', label: 'Dogukan Adal [Tvo]' },
        { channelHandle: '@tenticra', label: 'Tenticra' },
        { channelHandle: '@hugola', label: 'Hugola' },
        { channelHandle: '@aphernix', label: 'Aphernix' },
        { channelHandle: '@berkayinan', label: 'Berkay Inan' }
    ],

    sections: [
        {
            id: 'newest',
            title: 'En Yeni',
            source: 'newest',
            maxVideos: 20
        },
        {
            id: 'popular',
            title: 'En Populer',
            source: 'popular',
            maxVideos: 20
        }
    ]
};
